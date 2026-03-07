import { BillingStatus } from '../enums/billing-status.enum';

/**
 * SubscriptionEntity
 * Domain representation of an organization's billing subscription.
 * Derived from both the local DB record and the Stripe subscription object.
 */
export interface SubscriptionEntity {
  orgId: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  billingStatus: BillingStatus;
  planId: string | null;
  seatCount: number;
  /** Storage quota in bytes. Null means the plan default applies. */
  storageLimit: bigint | null;
  subscriptionPeriodStart: Date | null;
  subscriptionPeriodEnd: Date | null;
  /** If true, subscription cancels at the end of the current billing period. */
  cancelAtPeriodEnd: boolean;
}
