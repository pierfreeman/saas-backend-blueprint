# Notifications

Real-time in-app notification system for the SaaS backend.

## Architecture Overview

```
PostgreSQL  ←─────────────────────────────────── source of truth
    │
NotificationsService        business logic + Redis counter management
    │
Redis PubSub (transport)    two dedicated ioredis connections per pod
    │
NotificationsGateway        Socket.IO bridge + JWKS JWT verification
    │
Socket.IO (Redis adapter)   cross-pod room fanout
    │
Client
```

## Library Boundaries

| Path | Contents |
|---|---|
| `libs/notifications/types` | Shared interfaces, constants, cache key helpers |
| `libs/notifications/data-access` | `NotificationsService`, `NotificationsPubSubService` |
| `libs/notifications/realtime` | `NotificationsGateway`, `WsJwtGuard` |
| `libs/notifications/api` | `NotificationsModule`, `NotificationsController`, DTOs |

## REST API

All endpoints require a **Bearer JWT** (`Authorization: Bearer <token>`).

| Method | Path | Description |
|---|---|---|
| `GET` | `/notifications` | List notifications (paginated) |
| `GET` | `/notifications/unread-count` | Unread badge count |
| `POST` | `/notifications` | Create notification (admin / internal) |
| `PATCH` | `/notifications/:id/read` | Mark one as read |
| `PATCH` | `/notifications/read` | Mark many as read (body: `{ ids: string[] }`) |
| `DELETE` | `/notifications/:id` | Delete a notification |

### Query Parameters — `GET /notifications`

| Param | Type | Default | Description |
|---|---|---|---|
| `orgId` | `uuid` | — | Filter by organisation |
| `unreadOnly` | `boolean` | `false` | Return only unread items |
| `limit` | `number` | `20` | Max results (1-100) |
| `offset` | `number` | `0` | Pagination offset |

## WebSocket

Namespace: `/notifications`

### Connection

```js
import { io } from 'socket.io-client';

const socket = io('/notifications', {
  auth: { token: accessToken },
  transports: ['websocket', 'polling'],
});
```

Token extraction order: `handshake.auth.token` → `query.token` → `Authorization` header.

### Events emitted by the server

| Event | Payload | Description |
|---|---|---|
| `notification:new` | `NotificationMessage` | A new notification arrived |
| `notification:unread-count` | `{ count: number }` | Updated unread badge count |
| `notification:list` | `Notification[]` | Response to `notification:get-all` |

### Events sent by the client

| Event | Payload | Description |
|---|---|---|
| `notification:get-all` | `{ orgId?, limit?, offset?, unreadOnly? }` | Fetch notification list |
| `notification:mark-read` | `{ notificationId: string }` | Mark one as read |
| `notification:mark-all-read` | `{ orgId: string }` | Mark all as read for an org |

## Redis Keys

| Key pattern | TTL | Description |
|---|---|---|
| `app:notifications:unread:<userId>` | 30 days | Per-user unread counter |
| `notifications:user:<userId>` | — | Pub/sub channel (user scope) |
| `notifications:org:<orgId>` | — | Pub/sub channel (org scope) |
| `notifications:global` | — | Pub/sub channel (global broadcast) |

Socket.IO adapter channels are managed internally by `@socket.io/redis-adapter`.

## Multi-Pod Scaling

The system is **stateless** — every pod:
1. Publishes to Redis (any pod can publish).
2. Subscribes via `NotificationsPubSubService` (user/org patterns + global).
3. Forwards received messages only to its **local sockets**.
4. Uses the `@socket.io/redis-adapter` to synchronise rooms across pods so that
   `server.to('user:<id>').emit(...)` reaches sockets on all pods.

```
Pod A  ──publish──►  Redis  ──pmessage──►  Pod A (local sockets)
                        │
                        └──────────────►  Pod B (local sockets)
                        │
                        └──────────────►  Pod N (local sockets)
```

## Prisma Schema

The `Notification` model lives in `prisma/schema.prisma` under the `public` schema.

```prisma
model Notification {
  id        String    @id @default(uuid()) @db.Uuid
  orgId     String    @map("org_id") @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  type      String
  title     String
  body      String    @db.Text
  metadata  Json?
  readAt    DateTime? @map("read_at")
  createdAt DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([orgId])
  @@index([userId])
  @@index([userId, readAt])
  @@index([orgId, createdAt])
  @@map("notifications")
  @@schema("public")
}
```

## Running Tests

```bash
# Unit tests (all notification libs)
npx nx run notifications-data-access:test
npx nx run notifications-realtime:test
npx nx run notifications-api:test

# Integration tests (requires running DB + Redis via docker-compose.test.yml)
npx nx run api-e2e:e2e --testPathPattern=notifications
```
