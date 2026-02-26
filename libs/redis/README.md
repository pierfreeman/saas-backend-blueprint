# @libs/redis

Shared Redis library exposing two independent services:

| Service         | Purpose                                               | Redis DB |
| --------------- | ----------------------------------------------------- | -------- |
| `CacheService`  | Key/value cache with TTL support                      | `1`      |
| `PubSubService` | Event publishing for async microservice communication | `0`      |

Both services manage their own `ioredis` connection and implement graceful shutdown via `OnModuleDestroy`.

---

## Installation in a NestJS module

```typescript
import { RedisModule } from '@libs/redis';

@Module({
  imports: [RedisModule],
})
export class FeatureModule {}
```

`RedisModule` exports both `CacheService` and `PubSubService` and is not global — import it in every module that needs it.

---

## CacheService

Key/value store backed by Redis DB `1` (separate from the Pub/Sub DB).

### API

```typescript
// Inject
constructor(private readonly cache: CacheService) {}

// Read (returns null on miss or deserialisation error)
const value = await this.cache.get<MyType>('my:key');

// Write with optional TTL in seconds (omit ttl for no expiry)
await this.cache.set('my:key', payload, 300); // expires in 5 min

// Delete
await this.cache.del('my:key');

// Flush entire cache DB (use with caution)
await this.cache.flush();

// Access the raw ioredis client for advanced operations
const client = this.cache.getClient();
```

> Values are automatically `JSON.stringify`/`JSON.parse`d. Store only serialisable data.

---

## PubSubService

Thin wrapper used to publish Redis channel messages. Workers subscribe on the same channel name.

### Publish an event (API side)

```typescript
import { PubSubService } from '@libs/redis';
import { REDIS_EVENTS, HeavyJobCreatedEvent } from '@libs/common';

// ...
const event: HeavyJobCreatedEvent = {
  jobId: 'uuid',
  tenantId: 'tenant-uuid',
  payload: { ... },
  createdAt: new Date(),
};
await this.pubSub.publish(REDIS_EVENTS.HEAVY_JOB_CREATED, event);
```

### Subscribe (worker side)

Workers use the raw ioredis instance to subscribe (see `apps/worker-a/src`):

```typescript
const redis = this.pubSub.getRedis();
await redis.subscribe(REDIS_EVENTS.HEAVY_JOB_CREATED);
redis.on('message', (channel, message) => {
  const event: HeavyJobCreatedEvent = JSON.parse(message);
  // handle...
});
```

### Registered event channels

All channel names are defined as constants in `@libs/common`:

```typescript
import { REDIS_EVENTS } from '@libs/common';

// REDIS_EVENTS.HEAVY_JOB_CREATED  →  'heavy.job.created'
```

When adding a new channel, add it to `libs/common/src/events/redis-events.ts` together with its payload interface.

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
