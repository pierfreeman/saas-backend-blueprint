# Billing Module

Stripe integration for subscription management, checkout, and webhook handling.

## Features

- Stripe Checkout Sessions
- Webhook event processing
- Subscription lifecycle management
- Plan upgrade/downgrade
- Customer portal

## Endpoints

- `POST /billing/checkout` - Create Stripe Checkout session
- `POST /billing/webhook` - Stripe webhook endpoint
- `POST /billing/portal` - Create Customer Portal session

## Setup

```bash
# Required environment variables
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO=price_...
STRIPE_PRICE_ID_ENTERPRISE=price_...
FRONTEND_URL=http://localhost:4200
```

## Webhook Events Handled

- `checkout.session.completed` - Create/upgrade subscription
- `customer.subscription.updated` - Update subscription status
- `customer.subscription.deleted` - Cancel subscription

## Documentation

For complete setup:
- [docs/04-QUICK_START_STRIPE.md](../../../docs/04-QUICK_START_STRIPE.md) - Quick start (5 min)
- [docs/06-STRIPE_SETUP.md](../../../docs/06-STRIPE_SETUP.md) - Complete Stripe setup

## Testing

```bash
# Test with Stripe CLI
stripe listen --forward-to localhost:3000/billing/webhook
stripe trigger checkout.session.completed
```
