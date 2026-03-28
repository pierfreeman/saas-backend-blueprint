# Planning

RFC 5545-compliant calendar and event system for the SaaS backend. Supports recurring events (RRULE), per-occurrence exceptions, RSVP attendance, and calendar range queries with occurrence expansion.

## Architecture Overview

```
HTTP request
    │
PlanningController       REST API, RBAC guards, Swagger docs
    │
PlanningService          business logic, optimistic locking, validation
    ├── RecurrenceService   RRULE expansion via rrule.js (in-memory)
    │
PlanningRepository       thin Prisma wrapper; no business logic
    │
PostgreSQL               source of truth (Event, EventAttendee, EventException)
```

## REST API

Base path: `/organizations/:orgId/planning/events`

All endpoints require a **Bearer JWT** (`Authorization: Bearer <token>`).

| Method   | Path              | Permission        | Description                                                      |
| -------- | ----------------- | ----------------- | ---------------------------------------------------------------- |
| `POST`   | `/`               | `PLANNING_MANAGE` | Create an event (recurring or single)                            |
| `GET`    | `/`               | `ORG_READ`        | List occurrences in a date range (RRULE expanded)                |
| `GET`    | `/conflicts`      | `ORG_READ`        | List occurrences that overlap a range for the authenticated user |
| `GET`    | `/:id`            | `ORG_READ`        | Get full event detail with attendees & exceptions                |
| `PATCH`  | `/:id`            | `PLANNING_MANAGE` | Update an event (optimistic lock via `version`)                  |
| `DELETE` | `/:id`            | `PLANNING_MANAGE` | Soft-delete an event                                             |
| `POST`   | `/:id/rsvp`       | `ORG_READ`        | Upsert RSVP for the authenticated user                           |
| `POST`   | `/:id/exceptions` | `PLANNING_MANAGE` | Create or update a single-occurrence exception                   |

### Query Parameters — `GET /organizations/:orgId/planning/events`

| Param  | Type       | Required | Description                                       |
| ------ | ---------- | -------- | ------------------------------------------------- |
| `from` | `ISO 8601` | ✓        | Range start (inclusive). Must be before `to`.     |
| `to`   | `ISO 8601` | ✓        | Range end (exclusive). Max 365 days after `from`. |

The response is a flat array of `EventOccurrence` objects sorted by `startUtc`. Recurring events are expanded in-memory by `RecurrenceService` up to a hard limit of 500 occurrences per query. Exception overrides and cancellations are merged before the array is returned.

### Query Parameters — `GET /organizations/:orgId/planning/events/conflicts`

| Param   | Type       | Required | Description                                        |
| ------- | ---------- | -------- | -------------------------------------------------- |
| `start` | `ISO 8601` | ✓        | Range start (inclusive). Must be before `end`.     |
| `end`   | `ISO 8601` | ✓        | Range end (exclusive). Max 365 days after `start`. |

Returns all `EventOccurrence` objects where the authenticated user is **creator or attendee** and the occurrence truly overlaps the half-open interval `[start, end)`. Back-to-back events are **not** considered conflicts. Results are sorted by `startUtc`.

## Create / Update Event — Request Body

| Field             | Type       | Required | Description                                                                                                                                   |
| ----------------- | ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`           | `string`   | ✓        | Event title (max 255 chars)                                                                                                                   |
| `description`     | `string`   | –        | Optional free-text description                                                                                                                |
| `location`        | `string`   | –        | Optional location string                                                                                                                      |
| `startUtc`        | `ISO 8601` | ✓        | Start date-time in UTC                                                                                                                        |
| `endUtc`          | `ISO 8601` | ✓        | End date-time in UTC. Must be after `startUtc`.                                                                                               |
| `isAllDay`        | `boolean`  | –        | Defaults to `false`                                                                                                                           |
| `eventTimezone`   | `string`   | –        | IANA timezone (e.g. `Europe/Rome`). Defaults to UTC.                                                                                          |
| `rrule`           | `string`   | –        | RFC 5545 RRULE string (omit for one-off events)                                                                                               |
| `rruleUntilUtc`   | `ISO 8601` | –        | Convenience alias for `UNTIL=` inside the RRULE                                                                                               |
| `reminderMinutes` | `integer`  | –        | Minutes before event start to send a reminder notification. Must be between 1 and 1440. Pass `null` on update to remove an existing reminder. |
| `metadata`        | `object`   | –        | Arbitrary JSON metadata attached to the event                                                                                                 |

## Reminder Notifications

`PlanningReminderSchedulerService` runs a `@Cron(EVERY_5_MINUTES)` sweep inside the API process. It checks all events whose `reminderMinutes` is set and fires an in-app notification through `NotificationsService.notifyManyUsers()` at the right moment.

**Non-recurring events:** a single notification is sent once `now >= startUtc - reminderMinutes` and no reminder has been sent yet (`lastReminderOccurrenceUtc IS NULL`).

**Recurring events:** per-occurrence semantics. The sweep expands occurrences in the window `[lastReminderOccurrenceUtc ?? startUtc, now + 1440 min]`, fires for every due occurrence in chronological order, and advances `lastReminderOccurrenceUtc` as a high-water mark so no occurrence is notified twice.

Notification payload:

```json
{
  "type": "event.reminder",
  "title": "Event reminder",
  "body": "\"My event\" starts in 15 minutes",
  "metadata": { "entityRef": { "type": "event", "id": "<eventId>" } }
}
```

> **TODO (deferred):** after a bulk RRULE update the `lastReminderOccurrenceUtc` high-water mark may point past occurrences that no longer exist in the new RRULE; a background job to reset the mark would prevent missed or double reminders.

## Recurrence (RRULE)

- Supported frequencies: `FREQ=DAILY`, `FREQ=WEEKLY`, `FREQ=MONTHLY`, `FREQ=YEARLY`
- Modifiers: `BYDAY`, `BYMONTHDAY`, `COUNT`, `UNTIL`, `INTERVAL`
- `RecurrenceService` uses `rrule.js` to expand occurrences in-memory
- Max **500 occurrences** returned per range query (hard limit)
- Max range width: **365 days** (enforced by the controller)

Example RRULE for every Tuesday and Thursday: `FREQ=WEEKLY;BYDAY=TU,TH`

## Exceptions (single-occurrence overrides)

`POST /:id/exceptions` allows override or cancellation of a single occurrence of a recurring event without modifying the base RRULE:

| Field              | Type       | Required | Description                                     |
| ------------------ | ---------- | -------- | ----------------------------------------------- |
| `originalStartUtc` | `ISO 8601` | ✓        | Identifies which occurrence to override         |
| `isCancelled`      | `boolean`  | –        | `true` = hide this occurrence from the calendar |
| `startUtc`         | `ISO 8601` | –        | Rescheduled start for this occurrence           |
| `endUtc`           | `ISO 8601` | –        | Rescheduled end for this occurrence             |
| `title`            | `string`   | –        | Override title for this occurrence              |
| `description`      | `string`   | –        | Override description for this occurrence        |
| `location`         | `string`   | –        | Override location for this occurrence           |

## RSVP

`POST /:id/rsvp` upserts the authenticated user's attendance status for a specific event occurrence (or the base event for single events).

| Field    | Type         | Description                                 |
| -------- | ------------ | ------------------------------------------- |
| `status` | `RSVPStatus` | One of: `ACCEPTED`, `DECLINED`, `TENTATIVE` |

## RBAC

| Permission        | Minimum role | Operations                                       |
| ----------------- | ------------ | ------------------------------------------------ |
| `PLANNING_MANAGE` | `MEMBER`     | Create, update, delete events; manage exceptions |
| `ORG_READ`        | `READ_ONLY`  | List occurrences, get event detail, submit RSVP  |

Only the event creator (or an `ADMIN`/`OWNER`) can delete an event (`DELETE /:id`).

## Optimistic Locking

Every `Event` row carries a `version` integer. `PATCH /:id` requires the caller to send the current `version`; if the value no longer matches, the endpoint returns **409 Conflict**. This prevents silent overwrites when two clients update the same event concurrently.

## Prisma Schema

```prisma
enum RSVPStatus {
  ACCEPTED
  DECLINED
  TENTATIVE

  @@schema("public")
}

model Event {
  id              String    @id @default(uuid()) @db.Uuid
  orgId           String    @map("org_id") @db.Uuid
  createdByUserId String    @map("created_by_user_id") @db.Uuid
  title           String
  description     String?   @db.Text
  location        String?
  startUtc        DateTime  @map("start_utc")
  endUtc          DateTime  @map("end_utc")
  isAllDay        Boolean   @default(false) @map("is_all_day")
  eventTimezone   String    @default("UTC") @map("event_timezone")
  rrule           String?   @db.Text
  rruleUntilUtc   DateTime? @map("rrule_until_utc")
  reminderMinutes         Int?      @map("reminder_minutes")
  lastReminderOccurrenceUtc DateTime? @map("last_reminder_occurrence_utc")
  version         Int       @default(0)
  metadata        Json?
  deletedAt       DateTime? @map("deleted_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")

  attendees  EventAttendee[]
  exceptions EventException[]

  @@index([reminderMinutes, deletedAt])
  @@map("events")
  @@schema("public")
}

model EventAttendee {
  id        String     @id @default(uuid()) @db.Uuid
  eventId   String     @map("event_id") @db.Uuid
  userId    String     @map("user_id") @db.Uuid
  status    RSVPStatus @default(TENTATIVE)
  createdAt DateTime   @default(now()) @map("created_at")
  updatedAt DateTime   @updatedAt @map("updated_at")

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([eventId, userId])
  @@map("event_attendees")
  @@schema("public")
}

model EventException {
  id               String    @id @default(uuid()) @db.Uuid
  eventId          String    @map("event_id") @db.Uuid
  originalStartUtc DateTime  @map("original_start_utc")
  startUtc         DateTime? @map("start_utc")
  endUtc           DateTime? @map("end_utc")
  isCancelled      Boolean   @default(false) @map("is_cancelled")
  title            String?
  description      String?   @db.Text
  location         String?
  createdAt        DateTime  @default(now()) @map("created_at")

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([eventId, originalStartUtc])
  @@map("event_exceptions")
  @@schema("public")
}
```

## Running Tests

```bash
# Unit tests
npx nx run planning:test

# Integration tests (requires running infra via docker-compose.test.yml)
npx nx run api-e2e:e2e --testPathPattern=planning
```

---

## Deferred / Known Limitations

| Item                                            | Notes                                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "This and Following" recurrence modification    | Requires splitting the series (set `rruleUntilUtc` on the original row, create a new `Event` for the tail). Not implemented — single-occurrence exceptions only. |
| RDATE support                                   | `RecurrenceService` does not parse `RDATE` (explicit additional dates). Use `RRuleSet` if needed.                                                                |
| Reminder high-water mark reset after RRULE edit | After a bulk RRULE update, `lastReminderOccurrenceUtc` may reference a now-nonexistent occurrence and should be cleared (async job).                             |
| Paginated attendee listing                      | Attendees are returned inline on `GET /:id`. Future: `GET /:id/attendees?page=&limit=`.                                                                          |
