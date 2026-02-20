# Players Module

Manages players within teams with statistics and complete profiles.

## Features

- Player CRUD operations
- Team association
- Player statistics
- Organization-scoped access
- RBAC integration

## Database Schema

Table `players`:
- `id`, `orgId`, `teamId`
- `firstName`, `lastName`, `email`
- `dateOfBirth`, `position`
- `jerseyNumber`
- `statistics` (JSONB)
- `createdAt`, `updatedAt`

## Endpoints

- `GET /players` - List players (org-scoped)
- `GET /players/:id` - Get player details
- `POST /players` - Create player
- `PATCH /players/:id` - Update player
- `DELETE /players/:id` - Delete player

## RBAC Permissions

- `player.read` - View players
- `player.create` - Create players
- `player.update` - Update players
- `player.delete` - Delete players

## Usage

```typescript
// Create player
const player = await this.playersService.create({
  orgId,
  teamId,
  firstName: 'John',
  lastName: 'Doe',
  position: 'FORWARD',
  jerseyNumber: 10
});

// Get team players
const players = await this.playersService.findByTeam(teamId);
```

## Documentation

See [docs/18-RBAC_USAGE_GUIDE.md](../../../docs/18-RBAC_USAGE_GUIDE.md) for RBAC examples.
