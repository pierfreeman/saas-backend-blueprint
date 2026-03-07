# @libs/billing

Stripe-based subscription billing module for the SaaS backend blueprint. Provides customer management, checkout, customer portal, subscription synchronisation, and webhook ingestion — wired into the existing activity-log, legal-audit, and event-bus infrastructure.

The library contains only **shared business logic and infrastructure** (services, repositories, webhook handlers). HTTP controllers live in the API app layer at `apps/api/src/app/billing/`, following the same pattern used by `ActivityLogAppModule`.

---

## Directory layout

```
libs/billing/src/
├── domain/
│   ├── enums/
│   │   └── billing-status.enum.ts          # TypeScript mirror of the Prisma BillingStatus enum
│   └── entities/
│       └── subscription.entity.ts          # In-memory subscription value object
├── infrastructure/
│   ├── stripe/
│   │   ├── stripe.client.ts                # Initialises the Stripe SDK on module start
│   │   └── stripe.service.ts               # Typed wrappers: customer / checkout / portal / subscription
│   └── repositories/
│       └── billing.repository.ts           # All Prisma reads/writes for billing state
├── application/
│   └── services/
│       ├── billing.service.ts              # HTTP-facing operations (checkout, portal, cancel…)
│       └── subscription.service.ts         # Stripe → DB synchronisation helpers
├── webhooks/
│   ├── handlers/
│   │   ├── checkout-completed.handler.ts   # Handles checkout.session.completed → SubscriptionService
│   │   ├── subscription-created.handler.ts
│   │   ├── subscription-updated.handler.ts
│   │   ├── invoice-paid.handler.ts
│   │   └── invoice-failed.handler.ts
│   └── webhook-dispatcher.service.ts       # Routes Stripe events to the correct handler
├── billing.module.ts                       # Provider-only module (no controllers)
└── index.ts                                # Public barrel exports

apps/api/src/app/billing/                   # HTTP transport layer (not in this lib)
├── dto/
│   ├── create-checkout-session.dto.ts
│   ├── create-portal-session.dto.ts
│   └── cancel-subscription.dto.ts
├── billing.controller.ts                   # POST /billing/checkout, /portal, /cancel; GET /billing/subscription
├── webhook.controller.ts                   # POST /billing/webhook (unauthenticated, Stripe-signed)
└── billing-app.module.ts                   # Imports BillingModule + AuthModule + RBACModule
```

---

## Architecture overview

```
Browser / mobile
      │
      ▼
BillingController           ←  apps/api/src/app/billing/
(JWT + RBAC guard)
      │
      ▼
BillingService              ←  libs/billing  (this lib)
      │
 ┌────┴────┐
 │         │
StripeService  BillingRepository
(Stripe API)   (Prisma – business DB)
      │
EventBusService  ◄── domain events (SQS FIFO in prod)
ActivityLogService
LegalAuditService
      │
Stripe ──► WebhookController ──► WebhookDispatcherService
(POST /billing/webhook)               │
                          ┌───────────┼───────────┐
                          │           │           │
                   SubscriptionCreated/Updated  InvoicePaid/Failed
                   Handler             Handler    Handler
                          │
                     SubscriptionService
                     (syncs DB from Stripe payload)
```

### Checkout flow

1. Client calls `POST /billing/checkout` with a `priceId`.
2. `BillingService.ensureStripeCustomer` creates a Stripe customer if `org.stripeCustomerId` is null and persists the ID.
3. `StripeService.createCheckoutSession` creates a `checkout.Session` in Stripe.
4. The `url` is returned to the client for redirect.
5. On completion Stripe fires `customer.subscription.created` → `WebhookController` → `WebhookDispatcherService` → `SubscriptionCreatedHandler`.

### Subscription lifecycle

| Stripe event                           | Handler                      | DB change                                                                   |
| -------------------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| `checkout.session.completed`           | `CheckoutCompletedHandler`   | `stripeCustomerId` (if missing), `subscriptionId`, `billingStatus = ACTIVE` |
| `customer.subscription.created`        | `SubscriptionCreatedHandler` | `billingStatus`, `planId`, `subscriptionId`, period fields                  |
| `customer.subscription.updated`        | `SubscriptionUpdatedHandler` | same fields — reflect latest Stripe state                                   |
| `customer.subscription.deleted`        | `SubscriptionUpdatedHandler` | `billingStatus = CANCELED`                                                  |
| `customer.subscription.trial_will_end` | `SubscriptionUpdatedHandler` | fires `BILLING_TRIAL_ENDING` domain event                                   |
| `invoice.payment_succeeded`            | `InvoicePaidHandler`         | ensures `billingStatus = ACTIVE`                                            |
| `invoice.payment_failed`               | `InvoiceFailedHandler`       | `billingStatus = PAST_DUE`                                                  |

---

## Webhook security

### Stripe signature verification

Every request to `POST /billing/webhook` is verified with HMAC-SHA256 before any application logic runs:

```
stripe.webhooks.constructEvent(rawBody, stripeSignatureHeader, STRIPE_WEBHOOK_SECRET)
```

`rawBody: true` is passed to `NestFactory.create()` in `main.ts` and `app-bootstrap.ts` so the raw `Buffer` is available on `request.rawBody`.

If the signature is invalid, Stripe's SDK throws and the controller returns **400**.

### Idempotency

Each successfully processed event writes a `BillingEvent` row (`stripe_event_id` unique constraint) **before** returning 200. If the same `stripeEventId` arrives again the controller returns 200 immediately without re-processing:

```
POST /billing/webhook
      │
      ▼
validate stripe-signature
      │
      ▼
select from billing_events where stripe_event_id = ?
      │ already exists → return 200
      │ new
      ▼
WebhookDispatcherService.dispatch(event)
      │
      ▼
insert billing_events (stripe_event_id, processed_at, payload_hash)
      │
      ▼
return 200
```

---

## Event dispatch

`BillingService` and the webhook handlers publish domain events through the shared `EventBusService` (already `@Global()`). No import of `EventsModule` is needed:

| Action                 | Domain event constant                          |
| ---------------------- | ---------------------------------------------- |
| Checkout completed     | `DOMAIN_EVENTS.BILLING_CHECKOUT_COMPLETED`     |
| Subscription created   | `DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CREATED`   |
| Subscription updated   | `DOMAIN_EVENTS.BILLING_SUBSCRIPTION_UPDATED`   |
| Subscription cancelled | `DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED` |
| Trial ending           | `DOMAIN_EVENTS.BILLING_TRIAL_ENDING`           |
| Payment succeeded      | `DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED`      |
| Payment failed         | `DOMAIN_EVENTS.BILLING_PAYMENT_FAILED`         |

In dev/test the `LocalTransport` delivers them in-process. In staging and production `SqsTransport` routes billing events to an SQS FIFO queue.

---

## Audit logging

Every state-changing operation writes to **both** log sinks (both are fire-and-forget — failures never block the primary flow):

| Sink                 | When                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ActivityLogService` | customer created, checkout created, portal accessed, checkout completed, subscription created/updated/cancelled, invoice paid/failed |
| `LegalAuditService`  | customer created, checkout created, portal session created, checkout completed, subscription created/cancelled, invoice paid/failed  |

---

## Stripe retry & exponential backoff

`StripeService` wraps every outbound Stripe SDK call in a `withRetry` helper. On transient errors it retries with exponential backoff before letting the error propagate.

| Variable                     | Default | Description                                                 |
| ---------------------------- | ------- | ----------------------------------------------------------- |
| `STRIPE_MAX_RETRIES`         | `3`     | Maximum retry attempts (set to `0` to disable)              |
| `STRIPE_RETRY_BASE_DELAY_MS` | `500`   | Delay before the first retry in ms; doubles on each attempt |

Retryable conditions: `StripeConnectionError`, `StripeAPIError` (5xx), `StripeRateLimitError`. Non-retryable errors (4xx, invalid request, signature failure) surface immediately.

The Stripe SDK's own `maxNetworkRetries` is set to `0` — all retry logic lives in the service layer so it is fully observable and unit-testable.

---

## Prisma schema changes

```prisma
enum BillingStatus {
  NONE
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  UNPAID
  INCOMPLETE
  INCOMPLETE_EXPIRED
  PAUSED
  @@schema("public")
}

model Organization {
  // … existing fields …
  stripeCustomerId        String?       @unique  @map("stripe_customer_id")
  subscriptionId          String?       @unique  @map("subscription_id")
  billingStatus           BillingStatus @default(NONE) @map("billing_status")
  planId                  String?       @map("plan_id")
  seatCount               Int           @default(1) @map("seat_count")
  storageLimit            BigInt?       @map("storage_limit")
  subscriptionPeriodStart DateTime?     @map("subscription_period_start")
  subscriptionPeriodEnd   DateTime?     @map("subscription_period_end")
  cancelAtPeriodEnd       Boolean       @default(false) @map("cancel_at_period_end")
  billingEvents           BillingEvent[]
  subscriptionSnapshots   SubscriptionSnapshot[]
}

model BillingEvent {
  id            String        @id @default(uuid()) @db.Uuid
  orgId         String?       @map("org_id") @db.Uuid
  stripeEventId String        @unique @map("stripe_event_id")
  processedAt   DateTime      @map("processed_at")
  payloadHash   String        @map("payload_hash")
  organization  Organization? @relation(fields: [orgId], references: [id])
  @@map("billing_events")
  @@schema("public")
}

model SubscriptionSnapshot {
  id                    String   @id @default(uuid()) @db.Uuid
  orgId                 String   @map("org_id") @db.Uuid
  stripeSubscriptionId  String   @map("stripe_subscription_id")
  planId                String?  @map("plan_id")
  status                String
  seats                 Int?
  seatLimit             Int?     @map("seat_limit")
  periodStart           DateTime @map("period_start")
  periodEnd             DateTime @map("period_end")
  createdAt             DateTime @default(now()) @map("created_at")
  organization          Organization @relation(fields: [orgId], references: [id])
  @@map("subscription_snapshots")
  @@schema("public")
}
```

After modifying `prisma/schema.prisma` run:

```bash
npx prisma migrate dev --name <description> --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

---

## Environment variables

| Variable                | Required    | Description                                                                           |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`     | Yes         | `sk_live_…` / `sk_test_…` Stripe secret key                                           |
| `STRIPE_WEBHOOK_SECRET` | Yes         | `whsec_…` from Stripe Dashboard → Webhooks                                            |
| `STRIPE_PRICE_ID_BASIC` | Recommended | Stripe Price ID for the Basic plan                                                    |
| `STRIPE_PRICE_ID_PRO`   | Recommended | Stripe Price ID for the Pro plan                                                      |
| `BILLING_SUCCESS_URL`   | No          | Redirect after successful checkout (default: `http://localhost:3000/billing/success`) |
| `BILLING_CANCEL_URL`    | No          | Redirect after cancelled checkout (default: `http://localhost:3000/billing/cancel`)   |
| `BILLING_RETURN_URL`    | No          | Return URL for the customer portal (default: `http://localhost:3000/billing`)         |

All Stripe variables are declared as `Joi.string().optional()` in `libs/config/src/env.validation.ts`. The module will start without them but Stripe calls will fail at the point of use.

---

## Local Stripe CLI testing

```bash
# Forward events to your local server
stripe listen --forward-to localhost:3000/billing/webhook

# Trigger test events
stripe trigger customer.subscription.created
stripe trigger invoice.payment_failed
```

The CLI prints the webhook signing secret (`whsec_…`) to use as `STRIPE_WEBHOOK_SECRET` during local development.

---

## Running tests

```bash
# Unit tests (117 tests across 11 suites)
npx nx run billing:test

# Integration tests (requires Docker Compose test environment)
docker compose -f docker-compose.test.yml up -d
node scripts/migrate-test.js
npx nx run api-e2e:e2e --testPathPattern=billing-webhooks
```
