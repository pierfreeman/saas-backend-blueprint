# Notifications Module

Real-time notification system integrated with WebSocket (Socket.IO) and Redis Pub/Sub.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Run migration
```bash
npx prisma migrate dev --name add_notifications
```

### 3. Configure .env
```env
REDIS_HOST=localhost
REDIS_PORT=6379
SOCKET_CORS_ORIGIN=http://localhost:3000
```

### 4. Start backend
```bash
npm run start:dev
```

## Components

- **NotificationsController**: REST API for CRUD operations
- **NotificationsService**: Business logic and persistence
- **NotificationsGateway**: WebSocket handler (Socket.IO)
- **NotificationsPubSubService**: Redis Pub/Sub for multi-instance scalability
- **WsJwtGuard**: JWT authentication for WebSocket

## WebSocket Events

### Server → Client
- `notification:new` - New notification
- `notification:read` - Notification read
- `notification:bulk-read` - Multiple notifications read
- `notification:unread-count` - Counter updated
- `notification:list` - Notification list

### Client → Server
- `notification:get-all` - Fetch notifications
- `notification:mark-read` - Mark as read
- `notification:mark-all-read` - Mark all as read

## Testing

```bash
# Unit tests
npm run test:unit -- notifications.service.spec

# Integration tests
npm run test:integration -- notifications

# E2E tests
npm run test:e2e -- notifications.e2e.spec
```

## Full Documentation

See: [docs/NOTIFICATIONS_SETUP.md](../../docs/NOTIFICATIONS_SETUP.md)

## Architecture

```
Client (WebSocket) ←→ NotificationsGateway
                              ↓
                     NotificationsService
                              ↓
                    ┌─────────┴─────────┐
                    ↓                   ↓
              Prisma (Postgres)    Redis Pub/Sub
```

## 💡 Esempio Uso

```typescript
// Invia notifica a un utente
await notificationsService.createNotification(userId, {
  type: 'welcome',
  title: 'Benvenuto!',
  body: 'Grazie per esserti registrato.',
  metadata: { action: 'onboarding' },
});

// Invia a più utenti
await notificationsService.notifyManyUsers([userId1, userId2], {
  type: 'team_update',
  title: 'Aggiornamento team',
  body: 'Il tuo team ha un nuovo membro.',
});
```
