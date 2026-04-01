# @libs/admin/billing

Admin service for viewing billing information and opening Stripe portal sessions for any organization.

## Responsibility

`AdminBillingService` provides a read-only billing overview and delegates Stripe
portal URL generation to `@libs/billing`.

## Operations

| Method                                        | Description                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `getBillingOverview(orgId)`                   | Returns the org's billing snapshot (Stripe status, plan, subscription window, cancel flag) |
| `getPortalUrl(orgId, returnUrl, adminUserId)` | Generates a Stripe Customer Portal URL for any org, on behalf of the admin                 |

## Billing overview shape

```ts
{
  (orgId,
    stripeCustomerId,
    subscriptionId,
    status,
    planId,
    subscriptionPeriodEnd,
    cancelAtPeriodEnd);
}
```

## Exports

| Symbol                 | Description                    |
| ---------------------- | ------------------------------ |
| `AdminBillingModule`   | Import in the admin app module |
| `AdminBillingService`  | Application service            |
| `AdminBillingOverview` | DTO type                       |

## Pattern

Pattern B (2-layer). Repository: `AdminBillingRepository` (read-only, never exported).
