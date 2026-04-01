# Email Module

Event-driven transactional email system for the SaaS Backend Blueprint.

## Overview

The `@libs/email` library provides production-ready transactional email capabilities using an event-driven architecture. It decouples business logic from email delivery, ensuring loose coupling and scalability.

### Key Features

- **Event-Driven Architecture**: Emails triggered by domain events, not direct service calls
- **Multiple Provider Support**: Abstracted provider interface (Resend, SMTP)
- **Template System**: Handlebars-based templates with data interpolation
- **Audit Logging**: Automatic logging to activity log and legal audit systems
- **Fire-and-Forget**: Email failures don't block business transactions
- **Multi-Tenant**: Full support for organization-scoped emails
- **Type-Safe**: Full TypeScript support with strict typing

---

## Architecture

```
Domain Event (USER_INVITED, EXPORT_COMPLETED, etc.)
    ↓
Event Handler (UserInvitedEmailHandler, ExportCompletedEmailHandler)
    ↓
EmailService (renders template, validates input)
    ↓
Email Provider (Resend, SMTP)
    ↓
External Email Service
```

This design ensures:

- Business logic remains independent of email infrastructure
- Email provider can be swapped without changing application code
- Email failures don't crash request handlers or block workflows

---

## Installation

The library is already set up as an Nx library. To use it in your application:

```typescript
// In your app module (e.g., apps/api/src/app/app.module.ts)
import { EmailModule } from '@libs/email';

@Module({
  imports: [
    // ... other modules
    EmailModule,
  ],
})
export class AppModule {}
```

---

## Configuration

### Environment Variables

Add these to your `.env` file:

```bash
# Email Provider Configuration
EMAIL_PROVIDER=resend                     # 'resend' or 'smtp'
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_FROM_NAME=Your SaaS Platform

# Resend Configuration (if EMAIL_PROVIDER=resend)
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxx

# SMTP Configuration (if EMAIL_PROVIDER=smtp)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false                          # 'true' for port 465, 'false' for others
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
```

### Validation

Environment variables are validated at startup using Joi schemas defined in `libs/config/src/env.validation.ts`. Missing required variables will prevent application startup.

---

## Email Provider

### Resend (Default)

The Resend provider uses the official `resend` SDK.

**Advantages**:

- Modern, developer-friendly API
- Built-in deliverability optimization
- Detailed analytics and logs
- React Email template support
- No server maintenance

**Setup**:

1. Create a Resend account at https://resend.com
2. Generate an API key
3. Add `RESEND_API_KEY` to `.env`
4. Verify sender email/domain in Resend dashboard

### Future Providers

The provider interface allows adding:

- AWS SES
- Postmark
- Mailgun
- Custom SMTP

To add a new provider:

1. Implement `EmailProvider` interface in `libs/email/src/lib/providers/`
2. Update factory in `EmailModule` to instantiate your provider
3. Add configuration to `libs/config/src/email.config.ts`

---

## Template System

### Template Structure

Templates are stored in `libs/email/src/lib/templates/*.hbs` using Handlebars syntax.

**Available Templates**:

- `user-invite.hbs` - User invitation emails
- `auth-login-link.hbs` - Authentication magic links
- `export-ready.hbs` - Data export completion notifications
- `system-alert.hbs` - System alerts and warnings

### Template Rendering

The `TemplateRendererService` provides:

- Template loading from filesystem
- Compilation and caching (for performance)
- Data interpolation with Handlebars
- HTML escaping for security

**Custom Handlebars Helpers**:

- `{{formatDate date}}` - Format dates (e.g., "March 12, 2026")
- `{{uppercase str}}` - Convert to uppercase
- `{{eq a b}}` - Equality check for conditionals

### Creating New Templates

1. Create a new `.hbs` file in `libs/email/src/lib/templates/`
2. Add the template name to `EmailTemplateName` type in `types/email-template.type.ts`
3. Use Handlebars syntax for dynamic content:

```handlebars
<html>
  <body>
    <h1>Hello {{userName}}!</h1>
    <p>{{message}}</p>
    <a href='{{actionUrl}}'>Click Here</a>
  </body>
</html>
```

---

## Usage

### Event-Driven (Recommended)

Emit domain events from your services; email handlers automatically send emails:

```typescript
// In your service (e.g., libs/billing/src/application/services/subscription.service.ts)
import { EventBusService, DOMAIN_EVENTS } from '@libs/events';

@Injectable()
export class SubscriptionService {
  constructor(private readonly eventBus: EventBusService) {}

  async inviteUser(data: InviteUserDto) {
    // ... business logic to create invitation ...

    // Emit domain event
    await this.eventBus.publish({
      eventType: DOMAIN_EVENTS.USER_INVITED,
      timestamp: new Date(),
      payload: {
        inviteeName: data.name,
        inviteeEmail: data.email,
        inviterName: currentUser.name,
        organizationName: org.name,
        organizationId: org.id,
        role: data.role,
        inviteUrl: `https://app.example.com/invite/${inviteToken}`,
        expiresAt: expirationDate,
      },
      tenantId: org.id,
      userId: currentUser.id,
    });

    // Email will be sent asynchronously
  }
}
```

The `UserInvitedEmailHandler` listens for this event and sends the email automatically.

### Direct Usage (Advanced)

For scenarios where you need to send emails directly:

```typescript
import { EmailService } from '@libs/email';

@Injectable()
export class YourService {
  constructor(private readonly emailService: EmailService) {}

  async sendCustomEmail() {
    await this.emailService.sendTransactionalEmail({
      templateName: 'user-invite',
      recipient: 'user@example.com',
      subject: 'Welcome to our platform!',
      data: {
        inviteeName: 'John Doe',
        inviterName: 'Jane Smith',
        organizationName: 'Acme Corp',
        role: 'Admin',
        inviteUrl: 'https://app.example.com/invite/abc123',
        expiresAt: new Date('2026-04-01'),
      },
      orgId: 'org-123', // Optional: for audit logging
      userId: 'user-456', // Optional: for audit logging
    });
  }
}
```

---

## Contact Management

### Overview

The email library supports creating contacts in the email provider's audience for marketing/lifecycle purposes. This is implemented as a **fire-and-forget** operation — failures are logged but never block business flows.

Contact creation is **provider-optional**: only providers that support audience management (e.g., Resend) implement it. SMTP providers silently skip contact operations.

### When Contacts Are Created

Contacts are added automatically during **first-time user provisioning** (`AuthService.provisionNewUser`). The contact includes:

| Field       | Source                       |
| ----------- | ---------------------------- |
| `email`     | User's email address         |
| `firstName` | Auth0 profile (if available) |
| `lastName`  | Auth0 profile (if available) |
| `org_id`    | Personal workspace org ID    |
| `org_name`  | Personal workspace org name  |

### Custom Properties

Resend contacts are created with custom properties (must be pre-defined in the Resend dashboard):

- **`org_id`** — The user's personal workspace organization ID
- **`org_name`** — The user's personal workspace organization name

### Usage

```typescript
import { EmailService } from '@libs/email';

@Injectable()
export class YourService {
  constructor(private readonly emailService: EmailService) {}

  addUserToAudience(user: User, org: Organization) {
    this.emailService.addContact({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      properties: {
        org_id: org.id,
        org_name: org.name,
      },
    });
  }
}
```

### Provider Support

| Provider | `sendEmail` | `createContact` |
| -------- | ----------- | --------------- |
| Resend   | ✅          | ✅              |
| SMTP     | ✅          | ❌ (skipped)    |

---

## Domain Events

### Available Email Events

Defined in `libs/events/src/constants/event-routing.constants.ts`:

```typescript
export const DOMAIN_EVENTS = {
  // Email-related events (Standard queue)
  USER_INVITED: 'user.invited',
  EXPORT_COMPLETED: 'export.completed',
  SYSTEM_ALERT_TRIGGERED: 'system.alert.triggered',
  // ... other events
};
```

### Event Handlers

- **UserInvitedEmailHandler** (`libs/email/src/lib/events/handlers/user-invited.handler.ts`)
  - Listens for `USER_INVITED` events
  - Sends invitation emails with organization details

- **ExportCompletedEmailHandler** (`libs/email/src/lib/events/handlers/export-completed.handler.ts`)
  - Listens for `EXPORT_COMPLETED` events
  - Sends download links for completed exports

### Creating Custom Handlers

1. Create handler in `libs/email/src/lib/events/handlers/`
2. Inject `EmailService`
3. Define event payload interface
4. Implement `handle(event: DomainEvent<YourPayload>)` method
5. Register in `EmailModule` providers

---

## Audit Logging

Every email send attempt is automatically logged to two systems:

### Activity Log (Business-Visible)

- Visible to organization admins
- Tracks: recipient, template, timestamp, success/failure
- Queryable via API
- Used for operational monitoring

### Legal Audit (Compliance)

- Immutable, append-only
- Stores hashed recipient (no raw PII)
- Survives organization deletion
- Compliance: GDPR Art. 5(2), ISO 27001

**Example Audit Events**:

```json
{
  "eventType": "email.sent",
  "orgId": "org-123",
  "triggerType": "system",
  "metadata": {
    "template": "user-invite",
    "recipientHash": "16_j***e",
    "status": "sent"
  }
}
```

---

## Error Handling

### Fire-and-Forget Pattern

Email sending uses a **fire-and-forget** pattern to prevent failures from blocking business logic:

```typescript
// Email failures are logged but don't throw errors
await emailService.sendTransactionalEmail({ ... });
// Business logic continues even if email fails
```

### Error Scenarios

| Scenario                 | Behavior                          |
| ------------------------ | --------------------------------- |
| Invalid recipient email  | Logged as error, email not sent   |
| Template rendering fails | Logged to audit, email not sent   |
| Provider API error       | Logged to audit, marked as failed |
| Activity log failure     | Email still sent, error logged    |
| Legal audit failure      | Email still sent, error logged    |

### Retry Logic

Currently, failed emails are not automatically retried. For production systems, consider:

- Implementing retry queues (e.g., SQS with DLQ)
- Using provider-level retry (SendGrid has built-in retries)
- Monitoring failed email audit logs

---

## Multi-Tenant Considerations

### Organization-Scoped Emails

Emails can be scoped to organizations via `orgId`:

```typescript
await emailService.sendTransactionalEmail({
  // ...
  orgId: 'org-123', // Enables org-specific audit logging
});
```

### Future Enhancements

The architecture supports:

- **Organization Branding**: Custom logos, colors per organization
- **Custom Domains**: Send emails from `noreply@customer-domain.com`
- **Template Overrides**: Organization-specific template variations
- **Locale Support**: Multi-language templates

---

## Testing

### Run Unit Tests

```bash
nx test email
```

### Run Integration Tests

Integration tests require the Postgres and Redis containers running:

```bash
docker compose up -d postgres postgres-legal redis
nx test email -- --testPathPattern=email.integration
```

### Run with Coverage

```bash
nx test email --coverage
```

### Test Structure

```
libs/email/src/lib/
  providers/resend.provider.spec.ts        # Provider unit tests
  templates/template-renderer.service.spec.ts  # Template rendering tests
  email.service.spec.ts                     # Service unit tests
  email.integration.spec.ts                 # Integration tests
```

### Mock Email Sending in Tests

```typescript
// Mock Resend in your tests
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

mockSend.mockResolvedValue({ data: { id: 'msg-123' }, error: null });

// Verify email was sent
expect(mockSend).toHaveBeenCalledWith(
  expect.objectContaining({
    to: ['test@example.com'],
    subject: 'Test Email',
  }),
);
```

---

## Local Development

### Testing Without Sending Real Emails

**Option 1: Use Resend Test Mode**

```bash
# Use Resend's test API key (emails accepted but not delivered)
RESEND_API_KEY=re_test_xxxxxxxxxxxx
```

**Option 2: Use MailHog (Local SMTP Server)**

```bash
# Run MailHog via Docker
docker run -d -p 1025:1025 -p 8025:8025 mailhog/mailhog

# Configure SMTP in .env
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false

# View emails at http://localhost:8025
```

**Option 3: Mock Provider in Tests**

See "Testing" section above.

---

## Production Checklist

Before deploying to production:

- [ ] Resend API key configured
- [ ] Sender email/domain verified in Resend
- [ ] `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME` set
- [ ] Email templates reviewed for branding consistency
- [ ] Audit logging tested (check activity log and legal audit tables)
- [ ] Error monitoring configured (Sentry captures email failures)
- [ ] Rate limits reviewed (Resend free tier: 100 emails/day, 3000/month)
- [ ] Resend audience created with custom properties `org_id` (string) and `org_name` (string)
- [ ] `RESEND_AUDIENCE_ID` set in environment
- [ ] Consider SPF, DKIM, DMARC for sender domain

---

## Troubleshooting

### Emails Not Sending

1. **Check Configuration**

   ```bash
   # Verify environment variables are loaded
   echo $RESEND_API_KEY
   ```

2. **Check Logs**

   ```bash
   # Look for Resend errors in application logs
   grep "Resend" logs/app.log
   ```

3. **Verify Resend Dashboard**
   - Check "Logs" tab for delivery status
   - Review bounce/block lists

### Template Not Found Error

```
Error: Template not found: my-template.hbs
```

**Solution**: Ensure template exists at `libs/email/src/lib/templates/my-template.hbs`

### Resend API Error: 403 Forbidden

**Cause**: Invalid or missing API key

**Solution**:

- Regenerate API key in the Resend dashboard
- Ensure the API key has the correct domain permissions
- Update `RESEND_API_KEY` in `.env`

---

## Contributing

When adding new email templates or features:

1. Follow existing patterns (see `user-invite.handler.ts` as reference)
2. Add comprehensive unit tests (80%+ coverage required)
3. Update this README with new templates/events
4. Test locally with Resend (or Mailpit for SMTP) before deploying

---

## License

Proprietary - Part of the SaaS Backend Blueprint

---

## Support

For issues or questions:

- Check application logs for error details
- Review Resend dashboard for delivery issues
- Contact the platform team for architecture questions
