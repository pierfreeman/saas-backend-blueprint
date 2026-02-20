import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * RBAC Permissions definitions
 */
const PERMISSIONS = [
  // Organization permissions
  { key: 'org.manage', description: 'Manage organization settings and configuration', category: 'org' },
  { key: 'org.billing.manage', description: 'Manage organization billing and subscription', category: 'org' },
  { key: 'org.members.invite', description: 'Invite new members to organization', category: 'org' },
  { key: 'org.members.remove', description: 'Remove members from organization', category: 'org' },
  { key: 'org.members.role.update', description: 'Update member roles', category: 'org' },
  { key: 'org.read', description: 'View organization details', category: 'org' },

  // Team permissions
  { key: 'team.create', description: 'Create new teams', category: 'team' },
  { key: 'team.update', description: 'Update team information', category: 'team' },
  { key: 'team.delete', description: 'Delete teams', category: 'team' },
  { key: 'team.read', description: 'View team details', category: 'team' },

  // Player permissions
  { key: 'player.create', description: 'Create new players', category: 'player' },
  { key: 'player.update', description: 'Update player information', category: 'player' },
  { key: 'player.delete', description: 'Delete players', category: 'player' },
  { key: 'player.read', description: 'View player details', category: 'player' },

  // Analytics permissions (bonus)
  { key: 'analytics.view', description: 'View analytics and reports', category: 'analytics' },
  { key: 'analytics.export', description: 'Export analytics data', category: 'analytics' },
];

/**
 * Role-Permission matrix
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  OWNER: [
    // All permissions
    'org.manage',
    'org.billing.manage',
    'org.members.invite',
    'org.members.remove',
    'org.members.role.update',
    'org.read',
    'team.create',
    'team.update',
    'team.delete',
    'team.read',
    'player.create',
    'player.update',
    'player.delete',
    'player.read',
    'analytics.view',
    'analytics.export',
  ],
  ADMIN: [
    // All except billing
    'org.members.invite',
    'org.members.remove',
    'org.members.role.update',
    'org.read',
    'team.create',
    'team.update',
    'team.delete',
    'team.read',
    'player.create',
    'player.update',
    'player.delete',
    'player.read',
    'analytics.view',
    'analytics.export',
  ],
  MEMBER: [
    // Standard member permissions
    'org.read',
    'team.create',
    'team.update',
    'team.read',
    'player.create',
    'player.update',
    'player.read',
    'analytics.view',
  ],
  COACH: [
    // Coach-specific permissions (alias for MEMBER with team/player focus)
    'org.read',
    'team.read',
    'player.create',
    'player.update',
    'player.read',
    'analytics.view',
  ],
  VIEWER: [
    // Read-only permissions (legacy alias for READ_ONLY)
    'org.read',
    'team.read',
    'player.read',
    'analytics.view',
  ],
  READ_ONLY: [
    // Read-only permissions
    'org.read',
    'team.read',
    'player.read',
    'analytics.view',
  ],
};

/**
 * Seed RBAC data
 */
export async function seedRBAC() {
  console.log('🔐 Seeding RBAC data...\n');

  // Create permissions
  console.log('Creating permissions...');
  const createdPermissions = new Map<string, string>();

  for (const permission of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({
      where: { key: permission.key },
    });

    if (existing) {
      console.log(`  ✓ Permission "${permission.key}" already exists`);
      createdPermissions.set(permission.key, existing.id);
    } else {
      const created = await prisma.permission.create({
        data: permission,
      });
      console.log(`  ✓ Created permission "${permission.key}"`);
      createdPermissions.set(permission.key, created.id);
    }
  }

  console.log(`\n✓ Created/verified ${PERMISSIONS.length} permissions\n`);

  // Create roles and assign permissions
  console.log('Creating roles and assigning permissions...');

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    let role = await prisma.role.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      role = await prisma.role.create({
        data: {
          name: roleName,
          scope: 'ORG',
          description: `Default ${roleName} role with predefined permissions`,
        },
      });
      console.log(`  ✓ Created role "${roleName}"`);
    } else {
      console.log(`  ✓ Role "${roleName}" already exists`);
    }

    // Assign permissions to role
    for (const permissionKey of permissionKeys) {
      const permissionId = createdPermissions.get(permissionKey);
      if (!permissionId) {
        console.warn(`  ⚠ Permission "${permissionKey}" not found, skipping`);
        continue;
      }

      const existing = await prisma.rolePermission.findUnique({
        where: {
          roleId_permissionId: {
            roleId: role.id,
            permissionId,
          },
        },
      });

      if (!existing) {
        await prisma.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId,
          },
        });
      }
    }

    console.log(`    → Assigned ${permissionKeys.length} permissions to ${roleName}`);
  }

  console.log('\n✅ RBAC seed completed successfully!\n');
  console.log('📊 Summary:');
  console.log(`   - Permissions: ${PERMISSIONS.length}`);
  console.log(`   - Roles: ${Object.keys(ROLE_PERMISSIONS).length}`);
  console.log('');
}

// Run seed if called directly
if (require.main === module) {
  seedRBAC()
    .catch((error) => {
      console.error('❌ Error seeding RBAC:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
