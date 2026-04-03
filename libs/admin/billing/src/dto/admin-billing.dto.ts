import type { BillingStatus } from '@libs/prisma-business';

// ── Response shapes ──────────────────────────────────────────────────────────

export interface AdminBillingOverview {
  orgId: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  billingStatus: BillingStatus;
  planId: string | null;
  subscriptionPeriodStart: Date | null;
  subscriptionPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Storage quota in bytes. Null means the plan default applies. */
  storageLimit: bigint | null;
}

// ── Action inputs ────────────────────────────────────────────────────────────

export interface GetPortalUrlInput {
  orgId: string;
  /** URL to redirect back to after the Stripe portal session ends. */
  returnUrl: string;
  /** Internal DB ID of the admin performing the action (for audit log). */
  actorAdminId: string;
}
