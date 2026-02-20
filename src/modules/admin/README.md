# Admin Module

Administration module with super-admin control for privileged operations.

## Features

- Super admin management
- System-wide configuration
- Admin-only operations
- Protected routes with specialized guards

## Endpoints

- `GET /admin/...` - Admin operations (super-admin only)

## Documentation

For complete documentation see [docs/00-INDEX.md](../../../docs/00-INDEX.md)

## Environment Variables

```bash
SUPER_ADMIN_EMAILS=admin@example.com,superadmin@example.com
```

## Guards

- `SuperAdminGuard` - Verifies user is super admin
