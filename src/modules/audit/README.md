# Audit Module

Complete audit logging system for tracking all sensitive operations.

## Features

- Automatic event logging
- User action tracking
- Metadata capture (IP, user agent, org context)
- Query capabilities for analytics

## Usage

```typescript
// Inject AuditService
constructor(private readonly auditService: AuditService) {}

// Log audit event
await this.auditService.log({
  type: 'USER_CREATED',
  userId: user.id,
  orgId: org.id,
  metadata: { email: user.email }
});
```

## Database Schema

Table `audit_events`:
- `id`, `type`, `userId`, `orgId`
- `metadata` (JSONB)
- `ipAddress`, `userAgent`
- `createdAt`

## Documentation

See:
- [docs/13-RBAC_SETUP.md](../../../docs/13-RBAC_SETUP.md) - Includes audit logging integration
- [docs/21-STORAGE_SETUP.md](../../../docs/21-STORAGE_SETUP.md) - Storage audit events
