# Organizations Module

Manages organizations (tenants) with auto-creation and subscription integration.

## Features

- Organization CRUD operations
- Auto-creation on first login (FREE plan)
- Subscription integration
- Multi-tenant isolation

## Database Schema

Table `organizations`:
- `id`, `name`, `slug`
- `ownerId`
- `createdAt`, `updatedAt`

## Endpoints

- `GET /organizations` - List user's organizations
- `GET /organizations/:id` - Get organization details
- `POST /organizations` - Create organization (manual)
- `PATCH /organizations/:id` - Update organization
- `DELETE /organizations/:id` - Delete organization

## Usage

```typescript
// Get organization
const org = await this.organizationsService.findById(orgId);

// Create organization
const newOrg = await this.organizationsService.create({
  name: 'My Team',
  ownerId: userId
});
```

## RBAC Permissions

- `org.read` - View organizations
- `org.create` - Create new organization
- `org.update` - Update organization
- `org.delete` - Delete organization

## Documentation

See [docs/00-INDEX.md](../../../docs/00-INDEX.md) for complete documentation.
