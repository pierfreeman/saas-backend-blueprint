/**
 * Event Routing Constants
 *
 * Defines which events go to SQS FIFO (guaranteed strict ordering)
 * and which go to SQS Standard (high throughput, no ordering guarantee).
 *
 * Rule: add a prefix to FIFO_EVENT_PREFIXES only when strict ordering
 * is a hard business requirement (e.g. billing).
 */

/**
 * Event prefixes that must be routed to SQS FIFO.
 * Matched by prefix: "billing.*", "subscription.*", etc.
 */
export const FIFO_EVENT_PREFIXES: readonly string[] = [
  'billing.',
  'subscription.',
  'payment.',
  'invoice.',
] as const;

/**
 * All other events are routed to SQS Standard.
 * In local development, both transports are backed by LocalTransport (in-memory).
 */

/**
 * Domain event name constants.
 * Single source of truth for all domain event type strings.
 * source of truth for all event names going forward.
 */
export const DOMAIN_EVENTS = {
  // Job computation (Standard queue)
  HEAVY_JOB_CREATED: 'heavy.job.created',
  HEAVY_JOB_COMPLETED: 'heavy.job.completed',
  HEAVY_JOB_FAILED: 'heavy.job.failed',

  // Billing (FIFO queue — strict ordering required)
  BILLING_CHECKOUT_COMPLETED: 'billing.checkout.completed',
  BILLING_SUBSCRIPTION_CREATED: 'billing.subscription.created',
  BILLING_SUBSCRIPTION_CANCELLED: 'billing.subscription.cancelled',
  BILLING_PAYMENT_SUCCEEDED: 'billing.payment.succeeded',
  BILLING_PAYMENT_FAILED: 'billing.payment.failed',

  // Subscription state (FIFO queue)
  SUBSCRIPTION_ACTIVATED: 'subscription.activated',
  SUBSCRIPTION_EXPIRED: 'subscription.expired',
  SUBSCRIPTION_PLAN_CHANGED: 'subscription.plan.changed',

  // Email / User notifications (Standard queue)
  USER_INVITED: 'user.invited',

  // Organization deletion (Standard queue)
  ORG_DELETION_REQUESTED: 'org.deletion.requested',
  ORG_DELETION_STARTED: 'org.deletion.started',
  ORG_DELETION_COMPLETED: 'org.deletion.completed',
  ORG_DELETION_FAILED: 'org.deletion.failed',

  // Organization export (Standard queue)
  ORG_EXPORT_REQUESTED: 'org.export.requested',
  ORG_EXPORT_STARTED: 'org.export.started',
  ORG_EXPORT_COMPLETED: 'org.export.completed',
  ORG_EXPORT_FAILED: 'org.export.failed',
} as const;

export type DomainEventType =
  (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];
