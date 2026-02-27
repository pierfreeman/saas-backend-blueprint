# @libs/redis

Shared Redis library exposing two independent services:

| Service         | Purpose                                            | Redis DB |
| --------------- | -------------------------------------------------- | -------- |
| `CacheService`  | Key/value cache with TTL support                   | `1`      |
| `PubSubService` | Real-time pub/sub for WebSocket broadcast channels | `0`      |

Both services manage their own `ioredis` connection and implement graceful
shutdown via `OnModuleDestroy`.

> **Domain event delivery (API → workers) is handled by `@libs/events` (SQS),
> not by Redis.** `PubSubService` is reserved for real-time channels such as
> WebSocket room broadcasts where low-latency fan-out is required and
> durability is not.

---

## Installation in a NestJS module

```typescript
import { RedisModule } from '@libs/redis';

@Module({
  imports: [RedisModule],
})
export class FeatureModule {}
```

`RedisModule` exports both `CacheService` and `PubSubService` and is **not**
global — import it in every module that needs it.

---

## CacheService

Key/value store backed by Redis DB `1` (separate from the pub/sub DB).

```typescript
// Inject
constructor(private readonly cache: CacheService) {}

// Read (returns null on miss or deserialisation error)
const value = await this.cache.get<MyType>('my:key');

// Write with optional TTL in seconds (omit ttl for no expiry)
await this.cache.set('my:key', payload, 300); // expires in 5 min

// Delete
await this.cache.del('my:key');

// Flush entire cache DB (use with caution in production)
await this.cache.flush();

// Access the raw ioredis client for advanced operations
const client = this.cache.getClient();
```

> Values are automatically `JSON.stringify`/`JSON.parse`d. Store only serialisable data.

---

## PubSubService

Thin wrapper around an ioredis connection on DB `0`. Intended for **real-time
push channels** — e.g. broadcasting to WebSocket rooms via a Socket.IO Redis
adapter, or pushing live notifications to connected clients.

```typescript
// Inject
constructor(private readonly pubSub: PubSubService) {}

// Publish a message to a named channel
await this.pubSub.publish('notifications:org-1', { type: 'alert', body: '...' });

// Access the raw ioredis instance when the adapter needs it directly
// (e.g. socket.io-redis createAdapter)
const redis = this.pubSub.getRedis();
```

### What PubSubService is NOT for

`PubSubService` does **not** replace a message queue. It provides no
durability, no retry, and no dead-letter handling. For asynchronous job
dispatch between the API and workers use `EventBusService` from `@libs/events`.

---

## Environment variables

| Variable     | Default     | Description    |
| ------------ | ----------- | -------------- |
| `REDIS_HOST` | `localhost` | Redis hostname |
| `REDIS_PORT` | `6379`      | Redis port     |

In Docker Compose these are set to `redis` / `6379` automatically.

---

## Nx tasks

```sh
npx nx build redis    # compile the library
npx nx test redis     # run unit tests
npx nx lint redis     # lint
```
