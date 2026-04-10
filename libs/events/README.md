# @libs/events

Shared event-bus library for domain event publishing across the monorepo.

Provides a single `EventBusService` facade that routes events to the correct
transport depending on the runtime environment, with **zero changes required
at the call-site** when switching between modes.

---

## Transport modes

| `EVENT_BUS_TRANSPORT` | Transport used                                                | Typical environment |
| --------------------- | ------------------------------------------------------------- | ------------------- |
| `local` _(default)_   | `LocalTransport` (EventEmitter2)                              | dev, unit tests     |
| `sqs`                 | `SqsStandardTransport` or `SqsFifoTransport`                  | AWS staging/prod    |
| `servicebus`          | `ServiceBusStandardTransport` or `ServiceBusSessionTransport` | Azure staging/prod  |

### Routing logic (SQS / Service Bus)

Events whose `eventType` starts with one of the prefixes in `FIFO_EVENT_PREFIXES`
are sent to the **FIFO/Session** queue; all others go to the **Standard** queue.

```
billing.*        →  SQS FIFO / SB Session   (strict ordering)
subscription.*   →  SQS FIFO / SB Session
payment.*        →  SQS FIFO / SB Session
invoice.*        →  SQS FIFO / SB Session
<everything else> →  SQS Standard / SB Standard  (high throughput)
```

In **Service Bus** mode, session queues replace FIFO queues.
The `sessionId` is derived from `event.messageGroupId ?? event.tenantId ?? 'default'`.

To add a new FIFO/Session-routed prefix, edit `FIFO_EVENT_PREFIXES` in
`libs/events/src/constants/event-routing.constants.ts`.

---

## Installation

`EventsModule` is `@Global()`. Import it **once** in `AppModule`:

```typescript
import { EventsModule } from '@libs/events';

@Module({
  imports: [EventsModule],
})
export class AppModule {}
```

`EventBusService` is then injectable in every module without further imports.

---

## Publishing an event

```typescript
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';
import { PrismaService } from '@libs/prisma';

@Injectable()
export class TasksService {
  constructor(
    private readonly eventBus: EventBusService,
    private readonly prisma: PrismaService,
  ) {}

  async createHeavyJob(tenantId: string, dto: CreateTaskDto, userId?: string) {
    const jobId = randomUUID();

    // 1. Persist PENDING record so the job is immediately queryable via REST
    await this.prisma.job.create({
      data: {
        id: jobId,
        orgId: tenantId,
        userId,
        type: 'heavy_job',
        status: 'PENDING',
        payload: dto as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      // 2. Enqueue (SQS Standard in production, LocalTransport in dev)
      await this.eventBus.publish({
        eventType: DOMAIN_EVENTS.HEAVY_JOB_CREATED, // → SQS Standard
        timestamp: new Date(),
        payload: { jobId, tenantId, data: dto },
        tenantId,
        userId,
      });
    } catch {
      // 3. Rollback: remove orphan PENDING row on publish failure
      await this.prisma.job.delete({ where: { id: jobId } });
      throw error;
    }

    return { jobId };
  }
}
```

`eventId` is auto-generated (UUID v4) if not provided.

---

## DomainEvent interface

```typescript
interface DomainEvent<T = Record<string, unknown>> {
  eventType: string; // dot-notation name, e.g. "heavy.job.created"
  timestamp: Date;
  payload: T; // typed job/domain data
  tenantId?: string; // multi-tenancy context
  userId?: string; // user who triggered the event
  eventId?: string; // deduplication ID (auto-generated if absent)
  messageGroupId?: string; // SQS FIFO group (defaults to tenantId)
}
```

---

## JobUpdateMessage interface

Used for Redis pub/sub messages that travel from workers to the `JobsGateway`
and are forwarded to WebSocket clients.

```typescript
import { JobUpdateMessage } from '@libs/events';

const msg: JobUpdateMessage = {
  jobId: 'uuid',
  status: JobStatus.DONE, // PENDING | PROCESSING | DONE | FAILED
  tenantId: 'org-1',
  userId: 'auth0|...',
  result: { processed: true }, // only on DONE
  error: undefined, // only on FAILED
  updatedAt: new Date().toISOString(),
};
```

Published by workers to `job:update:{tenantId}`, consumed by `JobsGateway`
via `pubSub.pSubscribe('job:update:*', handler)`.

---

## Consuming events (workers)

### SQS polling worker

Workers run as standalone NestJS application contexts and host a
`SqsConsumerService` that long-polls the Standard queue:

```typescript
// apps/worker-a/src/sqs-consumer.service.ts
@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  // polls SQS_STANDARD_QUEUE_URL
  // deserialises DomainEvent from MessageBody
  // delegates to WorkerController
  // deletes message on success → leaves it for DLQ on failure
}
```

### Azure Service Bus polling worker

`ServiceBusConsumerService` is the Azure equivalent, activated when
`EVENT_BUS_TRANSPORT=servicebus`:

```typescript
// apps/worker-a/src/servicebus-consumer.service.ts
@Injectable()
export class ServiceBusConsumerService
  implements OnModuleInit, OnModuleDestroy {
  // polls SERVICEBUS_STANDARD_QUEUE_NAME using peekLock mode
  // deserialises DomainEvent from message body
  // delegates to WorkerController
  // completeMessage() on success
  // abandonMessage() on handler failure (retryable)
  // deadLetterMessage() on parse failure (non-retryable)
}
```

Both consumer classes coexist in `app.module.ts` as providers. Only the one
matching the configured transport activates in `onModuleInit()`.

### Future Lambda worker

AWS Lambda is triggered natively by SQS. The Lambda handler receives
`SQSEvent` from the runtime; each record's `body` is a serialised `DomainEvent`:

```typescript
// apps/worker-lambda/src/handler.ts
export const handler = async (event: SQSEvent) => {
  for (const record of event.Records) {
    const domainEvent: DomainEvent = JSON.parse(record.body);
    // handle...
  }
};
```

No code changes are needed on the publisher side when a Lambda is added.

---

## Environment variables

### AWS SQS

| Variable                 | Required in | Description                                       |
| ------------------------ | ----------- | ------------------------------------------------- |
| `EVENT_BUS_TRANSPORT`    | all         | `local` (default), `sqs`, or `servicebus`         |
| `SQS_STANDARD_QUEUE_URL` | sqs mode    | SQS Standard queue URL                            |
| `SQS_FIFO_QUEUE_URL`     | sqs mode    | SQS FIFO queue URL (must end in `.fifo`)          |
| `AWS_REGION`             | sqs mode    | e.g. `eu-west-1`                                  |
| `AWS_ACCESS_KEY_ID`      | sqs mode    | Optional when running with an IAM Role            |
| `AWS_SECRET_ACCESS_KEY`  | sqs mode    | Optional when running with an IAM Role            |
| `SQS_ENDPOINT_URL`       | dev/CI      | LocalStack endpoint, e.g. `http://localhost:4566` |

### Azure Service Bus

| Variable                         | Required in     | Description                              |
| -------------------------------- | --------------- | ---------------------------------------- |
| `SERVICEBUS_CONNECTION_STRING`   | servicebus mode | Full connection string from Azure portal |
| `SERVICEBUS_STANDARD_QUEUE_NAME` | servicebus mode | Name of the standard (non-session) queue |
| `SERVICEBUS_SESSION_QUEUE_NAME`  | servicebus mode | Name of the session-enabled queue        |

---

## Event name constants

All event names are defined in `DOMAIN_EVENTS`:

```typescript
import { DOMAIN_EVENTS } from '@libs/events';

// Standard queue events
DOMAIN_EVENTS.HEAVY_JOB_CREATED; // 'heavy.job.created'
DOMAIN_EVENTS.HEAVY_JOB_COMPLETED; // 'heavy.job.completed'
DOMAIN_EVENTS.HEAVY_JOB_FAILED; // 'heavy.job.failed'

// FIFO queue events (billing / subscriptions)
DOMAIN_EVENTS.BILLING_CHECKOUT_COMPLETED; // 'billing.checkout.completed'
DOMAIN_EVENTS.BILLING_PAYMENT_SUCCEEDED;
DOMAIN_EVENTS.BILLING_PAYMENT_FAILED;
DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CREATED;
DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED;
DOMAIN_EVENTS.SUBSCRIPTION_ACTIVATED;
DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED;
DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED;
```

Add new event names here instead of defining inline strings.

---

## Local development with LocalStack (SQS)

To run SQS locally without hitting AWS, start LocalStack and point the
transport at it:

The `docker-compose.yml` already includes a LocalStack service and `scripts/localstack-init.sh` automatically creates both queues on startup.

To start SQS locally:

```sh
docker compose up -d localstack
```

Then set in `.env`:

```env
EVENT_BUS_TRANSPORT=sqs
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_ENDPOINT_URL=http://localhost:4566
SQS_STANDARD_QUEUE_URL=http://localhost:4566/000000000000/saas-backend-heavy-jobs
SQS_FIFO_QUEUE_URL=http://localhost:4566/000000000000/saas-backend-billing-events.fifo
```

## Local development with Azurite (Service Bus)

Azurite does **not** support Service Bus (it only emulates Blob/Queue/Table). For
local Service Bus testing, use the real Azure Service Bus namespace or skip
integration testing by keeping `EVENT_BUS_TRANSPORT=local`.

For unit tests, leave `EVENT_BUS_TRANSPORT` unset (defaults to `local`) — no
infrastructure is required.

---

## Nx tasks

```sh
npx nx build events   # compile the library
npx nx test events    # run unit tests
npx nx lint events    # lint
```
