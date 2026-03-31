/**
 * Envelope that wraps every realtime event published on Redis.
 *
 * The gateway reads this shape from every subscribed channel and forwards
 * the inner `payload` to the appropriate Socket.IO room.
 */
export interface RealtimeEvent<T> {
  /** Application-defined event name (e.g. "notification.created"). */
  event: string;
  /** Broadcast scope — determines which Redis channel carries the event. */
  scope: 'user' | 'org' | 'global';
  /** Target user ID (present when scope === 'user'). */
  userId?: string;
  /** Target org ID (present when scope === 'org'). */
  orgId?: string;
  /** Event-specific payload. */
  payload: T;
  /** ISO-8601 timestamp of when the event was produced. */
  timestamp: string;
}

/**
 * Payload carried by every notification-related realtime event.
 *
 * Published by `NotificationsPubSubService` and consumed by
 * `NotificationsGateway` to forward the event to the correct Socket.IO room.
 */
export interface NotificationMessage {
  notificationId: string;
  userId: string;
  orgId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

/** Well-known realtime event names. */
export const NOTIFICATION_EVENTS = {
  CREATED: 'notification.created',
  READ: 'notification.read',
  BULK_READ: 'notification.bulk-read',
} as const;

/** Redis channel helpers. */
export const NOTIFICATION_CHANNELS = {
  user: (userId: string) => `notifications:user:${userId}`,
  org: (orgId: string) => `notifications:org:${orgId}`,
  global: 'notifications:global',
} as const;

/** Redis pattern subscriptions used by the gateway. */
export const NOTIFICATION_PATTERNS = {
  user: 'notifications:user:*',
  org: 'notifications:org:*',
} as const;

/** Redis key for the per-user unread notification counter (TTL: 30 days). */
export const UNREAD_CACHE_KEY = (userId: string) =>
  `app:notifications:unread:${userId}`;

/** Redis key for the per-user-per-org unread notification counter (TTL: 30 days). */
export const UNREAD_ORG_CACHE_KEY = (userId: string, orgId: string) =>
  `app:notifications:unread:${userId}:${orgId}`;

/** TTL in seconds for the unread counter (30 days). */
export const UNREAD_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
