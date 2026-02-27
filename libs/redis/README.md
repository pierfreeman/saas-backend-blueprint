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

// Flush entire cache DB — throws in production (use with caution)
await this.cache.flushdb();

// Access the raw ioredis client for advanced operations
const client = this.cache.getClient();
```

> Values are automatically `JSON.stringify`/`JSON.parse`d. Store only serialisable data.

---

## PubSubService

Wrapper around **two dedicated ioredis connections** on DB `0`:

| Internal connection | Role |
| ------------------- | ---- |
| `publisher`  | Calls `PUBLISH` — used by workers and services to broadcast updates |
| `subscriber` | Calls `SUBSCRIBE` / `PSUBSCRIBE` — used by gateway listeners |

Redis does not allow a connection in subscribe mode to issue other commands,
so the two-connection design is mandatory.

```typescript
// Inject
constructor(private readonly pubSub: PubSubService) {}

// ── Publishing ────────────────────────────────────────────────────────────────

// Serialize and publish a payload to an exact channel
await this.pubSub.publish('job:update:org-1', { jobId: 'abc', status: 'DONE' });

// ── Subscribing (exact channel) ───────────────────────────────────────────────

import { PubSubHandler } from '@libs/redis';

const handler: PubSubHandler = (payload) => {
  console.log(payload); // already JSON-parsed
};
this.pubSub.subscribe('job:update:org-1', handler);

// ── Pattern-subscribing ───────────────────────────────────────────────────────

import { PatternHandler } from '@libs/redis';

const pHandler: PatternHandler = (channel, payload) => {
  // channel = 'job:update:org-1', payload already JSON-parsed
  console.log(channel, payload);
};
this.pubSub.pSubscribe('job:update:*', pHandler);

// ── Raw ioredis client (e.g. for socket.io-redis createAdapter) ───────────────
const redis = this.pubSub.getRedis(); // returns the publisher connection
```

### Channel naming convention

Workers publish to `job:update:{tenantId}`. The `JobsGateway` in `apps/api`
pattern-subscribes to `job:update:*` and fans out to the correct Socket.IO
rooms (`tenant:{tenantId}` and `user:{userId}`).

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
