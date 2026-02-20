import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed Storage Permissions
 * 
 * Adds file storage permissions to the database
 */
async function seedStoragePermissions() {
  console.log('🌱 Seeding storage permissions...');

  const permissions = [
    {
      key: 'file.upload',
      description: 'Upload files to storage',
      category: 'storage',
    },
    {
      key: 'file.read',
      description: 'View and download files',
      category: 'storage',
    },
    {
      key: 'file.delete',
      description: 'Delete files from storage',
      category: 'storage',
    },
    {
      key: 'file.manage',
      description: 'Full file management (upload, read, delete, update metadata)',
      category: 'storage',
    },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      update: permission,
      create: permission,
    });
    console.log(`✅ Permission: ${permission.key}`);
  }

  console.log('✅ Storage permissions seeded successfully');
}

/**
 * Assign storage permissions to default roles
 */
async function assignStoragePermissionsToRoles() {
  console.log('🔗 Assigning storage permissions to roles...');

  // Get permissions
  const fileUpload = await prisma.permission.findUnique({ where: { key: 'file.upload' } });
  const fileRead = await prisma.permission.findUnique({ where: { key: 'file.read' } });
  const fileDelete = await prisma.permission.findUnique({ where: { key: 'file.delete' } });
  const fileManage = await prisma.permission.findUnique({ where: { key: 'file.manage' } });

  if (!fileUpload || !fileRead || !fileDelete || !fileManage) {
    console.error('❌ Storage permissions not found');
    return;
  }

  // Find or create default roles
  const ownerRole = await prisma.role.upsert({
    where: { name: 'Owner' },
    update: {},
    create: {
      name: 'Owner',
      scope: 'ORG',
      description: 'Organization owner with full access',
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: {
      name: 'Admin',
      scope: 'ORG',
      description: 'Organization administrator',
    },
  });

  const memberRole = await prisma.role.upsert({
    where: { name: 'Member' },
    update: {},
    create: {
      name: 'Member',
      scope: 'ORG',
      description: 'Organization member',
    },
  });

  const coachRole = await prisma.role.upsert({
    where: { name: 'Coach' },
    update: {},
    create: {
      name: 'Coach',
      scope: 'ORG',
      description: 'Team coach',
    },
  });

  // Owner: file.manage (all permissions)
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: ownerRole.id,
        permissionId: fileManage.id,
      },
    },
    update: {},
    create: {
      roleId: ownerRole.id,
      permissionId: fileManage.id,
    },
  });
  console.log('✅ Owner -> file.manage');

  // Admin: file.manage
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: adminRole.id,
        permissionId: fileManage.id,
      },
    },
    update: {},
    create: {
      roleId: adminRole.id,
      permissionId: fileManage.id,
    },
  });
  console.log('✅ Admin -> file.manage');

  // Member: file.upload, file.read
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: memberRole.id,
        permissionId: fileUpload.id,
      },
    },
    update: {},
    create: {
      roleId: memberRole.id,
      permissionId: fileUpload.id,
    },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: memberRole.id,
        permissionId: fileRead.id,
      },
    },
    update: {},
    create: {
      roleId: memberRole.id,
      permissionId: fileRead.id,
    },
  });
  console.log('✅ Member -> file.upload, file.read');

  // Coach: file.upload, file.read, file.delete
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: coachRole.id,
        permissionId: fileUpload.id,
      },
    },
    update: {},
    create: {
      roleId: coachRole.id,
      permissionId: fileUpload.id,
    },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: coachRole.id,
        permissionId: fileRead.id,
      },
    },
    update: {},
    create: {
      roleId: coachRole.id,
      permissionId: fileRead.id,
    },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: coachRole.id,
        permissionId: fileDelete.id,
      },
    },
    update: {},
    create: {
      roleId: coachRole.id,
      permissionId: fileDelete.id,
    },
  });
  console.log('✅ Coach -> file.upload, file.read, file.delete');

  console.log('✅ Storage permissions assigned to roles');
}

async function main() {
  try {
    await seedStoragePermissions();
    await assignStoragePermissionsToRoles();
    console.log('\n🎉 Storage seed completed successfully!');
  } catch (error) {
    console.error('❌ Error seeding storage:', error);
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
