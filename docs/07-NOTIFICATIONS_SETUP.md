# Real-time Notifications System

Complete real-time notification system for sports-intelligence-backend using WebSocket (Socket.IO) + Redis Pub/Sub.

## Table of Contents

- [Architecture](#architecture)
- [Setup](#setup)
- [Usage](#usage)
- [REST API](#rest-api)
- [WebSocket Events](#websocket-events)
- [Testing](#testing)
- [Horizontal Scalability](#horizontal-scalability)

---

## Architecture

### Main Components

```
┌─────────────────┐
│   Client App    │
│  (Frontend)     │
└────────┬────────┘
         │ WebSocket + REST
         ▼
┌─────────────────────────────────────┐
│       NestJS Backend                │
│                                     │
│  ┌──────────────────────────────┐  │
│  │  NotificationsGateway        │  │
│  │  - WebSocket handler         │  │
│  │  - JWT Auth handshake        │  │
│  │  - User rooms                │  │
│  └──────────┬───────────────────┘  │
│             │                       │
│  ┌──────────▼───────────────────┐  │
│  │  NotificationsService        │  │
│  │  - Business Logic            │  │
│  │  - Crea notifiche            │  │
│  │  - Mark as read              │  │
│  └──────────┬───────────────────┘  │
│             │                       │
│  ┌──────────▼───────────────────┐  │
│  │  NotificationsPubSubService  │  │
│  │  - Redis Publisher           │  │
│  │  - Redis Subscriber          │  │
│  └──────────┬───────────────────┘  │
└─────────────┼───────────────────────┘
              │
              ▼
      ┌───────────────┐
      │     Redis     │
      │   Pub/Sub     │
      └───────┬───────┘
              │
      ┌───────▼────────┐
      │   Postgres     │
      │  (Prisma ORM)  │
      └────────────────┘
```

### Notification Flow

1. **Creation**: `NotificationsService.createNotification()`
   - Save to Postgres via Prisma
   - Publish to Redis: `notifications:user:{userId}`

2. **Redis Broadcast**:
   - All backend instances (even multiple) receive the event

3. **WebSocket Delivery**:
   - Gateway forwards to user's socket (if online)
   - Emits `notification:new` event

4. **Client receives**:
   - Real-time UI update

---

## Setup

### 1. Install Dependencies

```bash
cd /home/pserena/workspace/sports-intelligence-backend
npm install
```

Dependencies added:
- `@nestjs/websockets`
- `@nestjs/platform-socket.io`
- `socket.io`
- `socket.io-client` (devDependencies, for testing)

### 2. Configure Environment Variables

Update `.env`:

```bash
# Redis (already configured)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# WebSocket CORS (new)
SOCKET_CORS_ORIGIN=http://localhost:3000,http://localhost:4200
```

### 3. Run Database Migration

```bash
# Generate migration
npm run prisma:migrate

# Apply migration
npx prisma migrate dev --name add_notifications
```

This creates the `notifications` table with:
- `id` (uuid)
- `userId` (indexed)
- `type` (string)
- `title` (string)
- `body` (text)
- `metadata` (jsonb nullable)
- `readAt` (timestamp nullable)
- `createdAt` (timestamp)

### 4. Start Redis (if not already running)

```bash
# Docker
docker run -d -p 6379:6379 redis:alpine

# Or with docker-compose (if available)
docker-compose up -d redis
```

### 5. Start Backend

```bash
npm run start:dev
```

WebSocket will be available at:
```
ws://localhost:3000/notifications
```

---

## Usage

### Backend: Send Notification Programmatically

Inject `NotificationsService` in any module:

```typescript
import { NotificationsService } from './modules/notifications/services/notifications.service';

@Injectable()
export class MyService {
  constructor(private readonly notificationsService: NotificationsService) {}

  async sendWelcomeNotification(userId: string) {
    await this.notificationsService.createNotification(userId, {
      type: 'welcome',
      title: 'Welcome!',
      body: 'Thank you for registering on our platform.',
      metadata: {
        action: 'onboarding',
        timestamp: new Date().toISOString(),
      },
    });
  }

  async notifyTeamMembers(userIds: string[]) {
    await this.notificationsService.notifyManyUsers(userIds, {
      type: 'team_update',
      title: 'New team update',
      body: 'Your team has received a new update.',
    });
  }
}
```

### Frontend: WebSocket Connection

#### React/TypeScript Example with socket.io-client

See complete example: [10-client-example-react.example.tsx](./10-client-example-react.example.tsx)

```typescript
import { io, Socket } from 'socket.io-client';

let socket: Socket;

// Connection (after login, with JWT token)
const connectNotifications = (token: string) => {
  socket = io('http://localhost:3000/notifications', {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
  });

  socket.on('connect', () => {
    console.log('Connected to notifications');
  });

  socket.on('notification:new', (notification) => {
    console.log('New notification:', notification);
    // Update UI: show popup, increment badge, etc.
  });

  socket.on('notification:read', (notification) => {
    console.log('Notification marked as read:', notification);
    // Update UI: remove from unread list
  });

  socket.on('notification:unread-count', (data) => {
    console.log('Unread count:', data.count);
    // Update badge counter
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from notifications');
  });
};

// Mark as read
const markAsRead = (notificationId: string) => {
  socket.emit('notification:mark-read', { notificationId });
};

// Mark all as read
const markAllAsRead = () => {
  socket.emit('notification:mark-all-read');
};

// Fetch notification list
const fetchNotifications = (unreadOnly = false) => {
  socket.emit('notification:get-all', { unreadOnly, limit: 50, skip: 0 });
  
  socket.once('notification:list', (notifications) => {
    console.log('Notification list:', notifications);
  });
};

// Disconnection (logout)
const disconnectNotifications = () => {
  socket?.close();
};
```

---

## REST API

### Authentication

All APIs require JWT Bearer token in header:
```
Authorization: Bearer <your-jwt-token>
```

### Endpoints

#### `GET /notifications`

Get notifications for authenticated user.

**Query Parameters:**
- `unreadOnly` (boolean, optional): Only unread notifications
- `limit` (number, optional, default: 50, max: 100)
- `skip` (number, optional, default: 0)

**Response:**
```json
[
  {
    "id": "uuid",
    "userId": "uuid",
    "type": "info",
    "title": "Notification title",
    "body": "Notification body",
    "metadata": { "key": "value" },
    "readAt": null,
    "createdAt": "2026-02-13T10:00:00Z"
  }
]
```

#### `GET /notifications/unread-count`

Count unread notifications.

**Response:**
```json
{
  "count": 5
}
```

#### `POST /notifications`

Create new notification (for the user themselves - testing or special use).

**Body:**
```json
{
  "type": "info",
  "title": "Title",
  "body": "Notification body",
  "metadata": { "optional": "data" }
}
```

**Response:** Notification object

#### `PATCH /notifications/:id/read`

Mark notification as read.

**Response:** Notification object (with `readAt` updated)

#### `PATCH /notifications/read`

Mark multiple notifications as read, or all.

**Body:**
```json
{
  "notificationIds": ["uuid1", "uuid2"]  // Optional: if omitted, marks ALL as read
}
```

**Response:**
```json
{
  "count": 2
}
```

#### `DELETE /notifications/:id`

Delete notification.

**Response:** 204 No Content

---

## 🔌 WebSocket Events

### Client → Server

#### `notification:get-all`

Fetch lista notifiche.

**Payload:**
```typescript
{
  unreadOnly?: boolean;
  limit?: number;  // default: 50
  skip?: number;   // default: 0
}
```

**Response Event:** `notification:list`

#### `notification:mark-read`

Mark single notification as read.

**Payload:**
```typescript
{
  notificationId: string;
}
```

**Response Event:** `notification:read`

#### `notification:mark-all-read`

Mark all notifications as read.

**Payload:** (empty)

**Response Event:** `notification:bulk-read`

---

### Server → Client

#### `notification:new`

New notification received in real-time.

**Payload:**
```typescript
{
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}
```

#### `notification:read`

Notification marked as read.

**Payload:** Notification object

#### `notification:bulk-read`

Notifications marked as read in bulk.

**Payload:**
```typescript
{
  count: number;
}
```

#### `notification:unread-count`

Unread notification counter update.

**Payload:**
```typescript
{
  count: number;
}
```

#### `notification:list`

Response to `notification:get-all`.

**Payload:** Array of Notification objects

#### `notification:error`

Error during WebSocket operation.

**Payload:**
```typescript
{
  message: string;
}
```

---

## Testing

### Unit Tests

Test `NotificationsService` logic:

```bash
npm run test:unit -- notifications.service.spec
```

### Integration Tests

Test Redis Pub/Sub and Gateway:

```bash
# Ensure Redis is running
docker run -d -p 6379:6379 redis:alpine

npm run test:integration -- notifications
```

### E2E Tests

Test complete REST + WebSocket flow:

```bash
npm run test:e2e -- notifications.e2e.spec
```

**Note:** E2E tests require:
- Redis running
- Test database configured (see `test/setup/test-db.ts`)

---

## Horizontal Scalability

### Multi-Instance Support

The system is designed to work with **multiple backend instances** thanks to Redis Pub/Sub:

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│ Backend #1  │       │ Backend #2  │       │ Backend #3  │
│             │       │             │       │             │
│  Gateway    │       │  Gateway    │       │  Gateway    │
│  User A     │       │  User B     │       │  User C     │
└──────┬──────┘       └──────┬──────┘       └──────┬──────┘
       │                     │                     │
       └─────────────────────┼─────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Redis Pub/Sub  │
                    └─────────────────┘
```

**How it works:**

1. User A connected to Backend #1 creates a notification for User B
2. Backend #1 publishes to Redis: `notifications:user:{userId-B}`
3. **All backends** (1, 2, 3) receive the event from Redis
4. Backend #2 (where User B is connected) forwards via WebSocket

### Deploy Production

#### Kubernetes / Docker Swarm

Configure:
- Deployment with replica count > 1
- External Redis (AWS ElastiCache, Azure Redis, etc.)
- Session affinity **not needed** (thanks to Redis Pub/Sub)

**Kubernetes Example:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sports-intelligence-backend
spec:
  replicas: 3  # ✅ Scalabile
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
      - name: backend
        image: sports-intelligence-backend:latest
        env:
        - name: REDIS_HOST
          value: "redis-cluster.default.svc.cluster.local"
        - name: REDIS_PORT
          value: "6379"
```

---

## 🔒 Security

### Autenticazione WebSocket

The Gateway validates JWT on every connection:

1. Client sends token in handshake:
   ```typescript
   io('url', { auth: { token: 'Bearer xyz' } })
   ```

2. Gateway extracts and verifies token (JWT Auth0)

3. If valid: Associate `userId` with socket

4. If invalid: Disconnect immediately

### User Isolation

- Each user receives **only their own notifications**
- Isolated rooms: `user:{userId}`
- `userId` validation in every operation

---

## Monitoring

### Log Events

The system logs:
- WebSocket connections/disconnections
- Redis publications
- Delivery errors

**Log example:**
```
[NotificationsGateway] Client connected: socketId-123 (User: user-456)
[NotificationsPubSubService] Published notification to channel: notifications:user:user-456
[NotificationsGateway] Client disconnected: socketId-123 (User: user-456)
```

### Useful Metrics

- `userSockets.size`: Number of online users
- Notifications created count (Prisma)
- Redis pub/sub latency

---

## Troubleshooting

### WebSocket Won't Connect

1. Check CORS:
   ```env
   SOCKET_CORS_ORIGIN=http://localhost:3000
   ```

2. Verify valid JWT token

3. Check firewall/proxy (port 3000)

### Notifications Not Arriving in Real-time

1. Is Redis running?
   ```bash
   docker ps | grep redis
   ```

2. Check backend logs:
   ```bash
   npm run start:dev
   ```

3. Verify Redis subscriber active:
   ```
   [NotificationsPubSubService] Redis subscriber connected
   ```

### Tests Failing

1. Redis running for integration tests
2. Clean test database (migrations applied)
3. Port conflicts (close other backend instances)

---

## File Structure

```
src/modules/notifications/
├── controllers/
│   └── notifications.controller.ts     # REST API endpoints
├── services/
│   └── notifications.service.ts        # Business logic
├── gateway/
│   └── notifications.gateway.ts        # WebSocket handler
├── redis/
│   └── notifications-pubsub.service.ts # Redis Pub/Sub
├── guards/
│   └── ws-jwt.guard.ts                 # WebSocket auth guard
├── dto/
│   ├── create-notification.dto.ts
│   ├── notification-response.dto.ts
│   ├── mark-as-read.dto.ts
│   ├── get-notifications.dto.ts
│   └── index.ts
└── notifications.module.ts             # Module definition

test/
├── unit/
│   └── notifications.service.spec.ts
├── integration/
│   ├── notifications-pubsub.integration.spec.ts
│   └── notifications-gateway.integration.spec.ts
└── e2e/
    └── notifications.e2e.spec.ts

prisma/
└── migrations/
    └── XXXXXX_add_notifications/
        └── migration.sql
```

---

## Best Practices

### Rate Limiting (Future Enhancement)

To prevent notification spam:

```typescript
// Possible future implementation
async createNotification(userId: string, dto: CreateNotificationDto) {
  // Check rate limit (e.g. max 10 notifications/minute per user)
  const key = `notif-rate:${userId}`;
  const count = await this.redis.incr(key);
  if (count === 1) await this.redis.expire(key, 60);
  if (count > 10) throw new TooManyRequestsException();
  
  // Proceed with creation...
}
```

### Notification Preferences (Future)

Allow users to disable certain types:

```typescript
model NotificationPreferences {
  userId    String  @unique
  enabledTypes Json  // ["welcome", "team_update", ...]
}
```

### Offline Delivery Queue

Notifications are already persisted in Postgres, so:
- If user offline → Notification saved
- When they connect → Fetch via REST/WebSocket

---

## Implementation Checklist

- [x] Prisma `Notification` entity
- [x] Database migration
- [x] Validated DTOs
- [x] NotificationsService with complete logic
- [x] Redis Pub/Sub service
- [x] Authenticated WebSocket Gateway
- [x] REST API endpoints
- [x] Unit tests
- [x] Integration tests
- [x] E2E tests
- [x] Complete documentation
- [x] package.json updated
- [x] AppModule integrated

---

## Support

For questions or issues:
- Check backend logs
- Run tests: `npm test`
- Verify Redis/Postgres configuration

---

**Real-time notification system fully functional and production-ready!**
