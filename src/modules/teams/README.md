# Teams Module

Manages teams within organizations with players and coaches.

## Features

- Team CRUD operations
- Organization-scoped access
- Player associations
- Coach assignments
- RBAC integration

## Database Schema

Table `teams`:
- `id`, `orgId`
- `name`, `sport`, `category`
- `season`
- `createdAt`, `updatedAt`

## Endpoints

- `GET /teams` - List teams (org-scoped)
- `GET /teams/:id` - Get team details
- `POST /teams` - Create team
- `PATCH /teams/:id` - Update team
- `DELETE /teams/:id` - Delete team

## RBAC Permissions

- `team.read` - View teams
- `team.create` - Create teams
- `team.update` - Update teams
- `team.delete` - Delete teams

## Usage

```typescript
// Create team
const team = await this.teamsService.create({
  orgId,
  name: 'First Team',
  sport: 'SOCCER',
  category: 'SENIOR',
  season: '2025-2026'
});

// Get team with players
const teamWithPlayers = await this.teamsService.findByIdWithPlayers(teamId);
```

## Documentation

For RBAC integration see:
- [docs/13-RBAC_SETUP.md](../../../docs/13-RBAC_SETUP.md) - RBAC setup
- [docs/18-RBAC_USAGE_GUIDE.md](../../../docs/18-RBAC_USAGE_GUIDE.md) - Usage guide
