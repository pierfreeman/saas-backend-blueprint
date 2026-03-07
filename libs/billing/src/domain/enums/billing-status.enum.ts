/**
 * BillingStatus
 * TypeScript enum mirroring the Prisma BillingStatus enum (schema.prisma).
 * Maps to Stripe subscription statuses with a NONE sentinel for no subscription.
 */
export enum BillingStatus {
  /** No subscription exists. Organization is on the free tier. */
  NONE = 'NONE',
  /** Active free trial – payment method may be required to continue. */
  TRIALING = 'TRIALING',
  /** Active, paid subscription. */
  ACTIVE = 'ACTIVE',
  /** Payment failed; subscription remains active temporarily. */
  PAST_DUE = 'PAST_DUE',
  /** Subscription was explicitly canceled. May still be active until period end. */
  CANCELED = 'CANCELED',
  /** Final payment attempt failed; subscription suspended. */
  UNPAID = 'UNPAID',
  /** First payment has not yet been made. */
  INCOMPLETE = 'INCOMPLETE',
  /** Incomplete subscription expired without successful payment. */
  INCOMPLETE_EXPIRED = 'INCOMPLETE_EXPIRED',
  /** Subscription is paused (Stripe feature). */
  PAUSED = 'PAUSED',
}
