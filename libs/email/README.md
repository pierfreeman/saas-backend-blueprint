# @libs/email — Transactional Email Module

## Overview

`libs/email` provides transactional email capabilities for the SaaS backend platform. It implements an **event-driven architecture** that keeps business logic fully decoupled from email delivery infrastructure.

---

## Architecture

Email delivery is never triggered directly by services. Instead, it follows this flow:

```
Domain Event
    ↓
Event Handler  (libs/email/src/lib/events/handlers/)
    ↓
EmailService   (libs/email/src/lib/email.service.ts)
    ↓
EmailProvider  (libs/email/src/lib/providers/)
    ↓
SendGrid / AWS SES / Postmark / Resend
```

This design ensures:
- Business logic is **independent** of email infrastructure.
- The email provider can be swapped without touching domain services.
- Failed email delivery **never crashes** request handlers or domain logic.
- Every send attempt is **audit-logged** via `ActivityLogService`.

---

## Email Provider

The module uses an **EmailProvider abstraction** (`email-provider.interface.ts`) to support multiple providers:

```typescript
export interface EmailProvider {
  sendEmail(input: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<void>;
}
```

### SendGrid

The default provider is **SendGrid** (`sendgrid.provider.ts`), implemented using `@sendgrid/mail`.

Configuration:

| Environment Variable   | Description                    | Required |
|------------------------|--------------------------------|----------|
| `SENDGRID_API_KEY`     | SendGrid API key               | Yes (in prod) |
| `EMAIL_FROM_ADDRESS`   | Sender email address           | No (default: `noreply@example.com`) |
| `EMAIL_FROM_NAME`      | Sender display name            | No (default: `SaaS Platform`) |
| `EMAIL_PROVIDER`       | Provider selector (`sendgrid`) | No (default: `sendgrid`) |

> If `SENDGRID_API_KEY` is not set, the provider logs a warning and skips delivery. This is intentional for local development and test environments.

### Adding a New Provider

1. Implement the `EmailProvider` interface.
2. Register the new provider in `EmailModule` using the `EMAIL_PROVIDER_TOKEN` DI token.

---

## Template System

Templates are stored as **Handlebars** (`.hbs`) files in `libs/email/src/lib/templates/`.

### Available Templates

| Template Name       | Use Case                          |
|---------------------|-----------------------------------|
| `auth-login-link`   | Passwordless magic link emails    |
| `user-invite`       | Organisation invitation emails    |
| `export-ready`      | Export/download ready notifications |
| `system-alert`      | System-level alert notifications  |

### Template Rendering

Templates are loaded lazily on first use and cached for subsequent renders.
Handlebars provides **safe HTML escaping** by default — `{{variable}}` values are automatically escaped to prevent XSS.

```typescript
// Render a template programmatically
const html = templateService.render('user-invite', {
  inviterName: 'Alice',
  orgName: 'Acme Corp',
  inviteUrl: 'https://app.example.com/invite/abc123',
  expiresInDays: 7,
});
```

---

## Usage Example

### Emit a Domain Event (preferred approach)

```typescript
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';

// In your service:
await this.eventBus.publish({
  eventType: DOMAIN_EVENTS.USER_INVITED,
  timestamp: new Date(),
  payload: {
    recipientEmail: 'newuser@example.com',
    recipientName: 'New User',
    inviterName: 'Alice',
    orgId: 'org-uuid',
    orgName: 'Acme Corp',
    inviteUrl: 'https://app.example.com/invite/abc123',
    expiresInDays: 7,
  },
});
```

The `UserInvitedEmailHandler` listens for this event and automatically sends the invitation email.

### Direct EmailService Invocation (for custom scenarios)

```typescript
import { EmailService } from '@libs/email';

await this.emailService.sendTransactionalEmail({
  to: 'admin@example.com',
  subject: 'System Alert',
  template: 'system-alert',
  templateData: {
    alertType: 'CRITICAL',
    message: 'Database connection pool exhausted',
    orgName: 'Acme Corp',
    timestamp: new Date().toISOString(),
  },
  orgId: 'org-uuid',
});
```

### Import the Module

```typescript
import { EmailModule } from '@libs/email';

@Module({
  imports: [EmailModule],
})
export class AppModule {}
```

---

## Audit Logging

Every email send attempt generates an activity log entry:

| Event Type      | Action          | When                          |
|-----------------|-----------------|-------------------------------|
| `EMAIL_SENT`    | `email.sent`    | Provider returned success     |
| `EMAIL_FAILED`  | `email.failed`  | Provider error / render error / validation error |

Audit log payload includes: `recipient`, `template`, `orgId`, `status`, `timestamp`.

---

## Event Handlers

| Handler                       | Listens For               | Template Used    |
|-------------------------------|---------------------------|------------------|
| `UserInvitedEmailHandler`     | `user.invited`            | `user-invite`    |
| `ExportCompletedEmailHandler` | `export.completed`        | `export-ready`   |

---

## Local Development

### Environment Setup

Copy `.env.example` and configure email variables:

```bash
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=SG.your-key-here
EMAIL_FROM_ADDRESS=noreply@yourapp.com
EMAIL_FROM_NAME="Your App"
```

> For local development, leave `SENDGRID_API_KEY` empty. Emails will be skipped with a warning log.

### Running Tests

```bash
# Unit tests for the email library
nx test email

# With coverage
nx test email --coverage
```

### Test Strategy

- **Unit tests** mock the SendGrid SDK, TemplateService, and ActivityLogService.
- **Integration tests** wire up the full event pipeline with a mocked email provider (no real emails sent).
- No real HTTP calls are made during tests.
