import { ApiProperty } from '@nestjs/swagger';

/**
 * WebSocket payload DTOs for the `/notifications` Socket.IO namespace.
 *
 * These classes carry `@ApiProperty` decorators so that `nestjs-asyncapi`
 * can reflect their schema when building the AsyncAPI document.  They mirror
 * the TypeScript interfaces in `notification.types.ts` but as instantiatable
 * classes.
 *
 * Naming convention:
 *   - `*Dto`      — server → client payload (AsyncApiSub)
 *   - `WsGet*Dto` / `WsMark*Dto` — client → server payload (AsyncApiPub)
 */

// ── Server → client (clients subscribe) ──────────────────────────────────────

/**
 * Payload emitted as `notification:new`.
 *
 * Fired when a notification is created for the user (user-scope event) or
 * when an org-scope / global broadcast is triggered.
 */
export class NotificationMessageDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'Internal UUID of the notification.',
  })
  notificationId!: string;

  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'Internal UUID of the recipient user.',
  })
  userId!: string;

  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'Internal UUID of the owning organisation.',
  })
  orgId!: string;

  @ApiProperty({
    type: 'string',
    example: 'invite.accepted',
    description:
      'Application-defined category (e.g. "invite", "billing", "alert").',
  })
  type!: string;

  @ApiProperty({
    type: 'string',
    example: 'New member joined',
    description: 'Short notification title shown in the badge / list.',
  })
  title!: string;

  @ApiProperty({
    type: 'string',
    example: 'Alice accepted the invitation.',
    description: 'Full notification body text.',
  })
  body!: string;

  @ApiProperty({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    example: { invoiceId: 'inv_123', amount: 9900 },
    description:
      'Optional structured metadata (action links, entity IDs, …). Null when not provided.',
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    description: 'ISO-8601 timestamp when the notification was created.',
  })
  createdAt!: Date;
}

/**
 * Payload emitted as `notification:unread-count`.
 *
 * Sent immediately after the socket connects and after every operation that
 * changes the unread count (mark-as-read, mark-all-as-read, delete).
 */
export class UnreadCountDto {
  @ApiProperty({
    type: 'number',
    minimum: 0,
    example: 3,
    description:
      'Current number of unread notifications for the authenticated user.',
  })
  count!: number;
}

// ── Client → server (clients publish) ────────────────────────────────────────

/**
 * Payload sent by the client as `notification:get-all`.
 *
 * Requests a paginated, optionally-filtered list of notifications.
 * The server responds on the `notification:list` channel.
 */
export class WsGetAllDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    required: false,
    description:
      'Filter by organisation UUID. When omitted, returns notifications across all orgs.',
  })
  orgId?: string;

  @ApiProperty({
    type: 'number',
    minimum: 1,
    maximum: 100,
    default: 20,
    required: false,
    description:
      'Maximum number of notifications to return (1–100, default 20).',
  })
  limit?: number;

  @ApiProperty({
    type: 'number',
    minimum: 0,
    default: 0,
    required: false,
    description: 'Number of notifications to skip for pagination (default 0).',
  })
  offset?: number;

  @ApiProperty({
    type: 'boolean',
    required: false,
    description: 'When true, only unread notifications are returned.',
  })
  unreadOnly?: boolean;
}

/**
 * Payload sent by the client as `notification:mark-read`.
 *
 * Marks a single notification as read and triggers a `notification:unread-count`
 * response with the updated count.
 */
export class WsMarkReadDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description: 'UUID of the notification to mark as read.',
  })
  notificationId!: string;
}

/**
 * Payload sent by the client as `notification:mark-all-read`.
 *
 * Marks all unread notifications for the given organisation as read.
 * Triggers a `notification:unread-count` response with `count: 0`.
 */
export class WsMarkAllReadDto {
  @ApiProperty({
    type: 'string',
    format: 'uuid',
    description:
      'UUID of the organisation whose notifications should be marked as read.',
  })
  orgId!: string;
}
