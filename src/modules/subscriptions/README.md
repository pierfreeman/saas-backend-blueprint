# Subscriptions Module

Manages subscription plans and limits for organizations.

## Features

- Subscription plans (FREE, PRO, ENTERPRISE)
- Stripe integration for billing
- Plan limits enforcement
- Upgrade/downgrade handling

## Plans

| Plan | Price | Storage | Files | Max File Size |
|------|-------|---------|-------|---------------|
| FREE | $0/mo | 1 GB | 100 | 100 MB |
| PRO | $29/mo | 50 GB | 10,000 | 20 GB |
| ENTERPRISE | Custom | Unlimited | Unlimited | 100 GB |

## Database Schema

Table `subscriptions`:
- `id`, `orgId`
- `plan` (FREE | PRO | ENTERPRISE)
- `status` (ACTIVE | CANCELED | PAST_DUE)
- `stripeCustomerId`, `stripeSubscriptionId`
- `currentPeriodStart`, `currentPeriodEnd`
- `createdAt`, `updatedAt`

## Usage

```typescript
// Get subscription
const subscription = await this.subscriptionsService.findByOrgId(orgId);

// Check plan
if (subscription.plan === SubscriptionPlan.FREE) {
  // Limited features
}

// Upgrade plan (via Stripe)
await this.billingService.createCheckoutSession({
  orgId,
  priceId: process.env.STRIPE_PRICE_ID_PRO
});
```

## Documentation

For Stripe setup see:
- [docs/04-QUICK_START_STRIPE.md](../../../docs/04-QUICK_START_STRIPE.md) - Quick start
- [docs/06-STRIPE_SETUP.md](../../../docs/06-STRIPE_SETUP.md) - Complete setup
