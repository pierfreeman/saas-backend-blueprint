#!/bin/bash
# RBAC System - Quick Commands Reference

echo "🔐 RBAC System - Quick Commands"
echo "================================"
echo ""

# Database commands
echo "📦 DATABASE COMMANDS"
echo "-------------------"
echo "# Apply RBAC migration:"
echo "npx prisma migrate dev"
echo ""
echo "# Run RBAC seed (populate roles & permissions):"
echo "npx ts-node prisma/seeds/rbac.seed.ts"
echo ""
echo "# Check database (roles, permissions):"
echo "npx prisma studio"
echo ""

# Testing commands
echo "🧪 TESTING COMMANDS"
echo "------------------"
echo "# Run all RBAC tests:"
echo "npm test -- --testPathPatterns=rbac"
echo ""
echo "# Run specific test file:"
echo "npm test -- rbac.service.spec.ts"
echo ""
echo "# Run with coverage:"
echo "npm test -- --testPathPatterns=rbac --coverage"
echo ""

# Build commands
echo "🏗️  BUILD COMMANDS"
echo "-----------------"
echo "# Build project:"
echo "npm run build"
echo ""
echo "# Type check:"
echo "npx tsc --noEmit"
echo ""

# Redis commands
echo "💾 REDIS COMMANDS"
echo "----------------"
echo "# Check RBAC cache keys:"
echo "redis-cli KEYS 'rbac:*'"
echo ""
echo "# Get specific cache entry:"
echo "redis-cli GET 'rbac:user:{userId}:org:{orgId}'"
echo ""
echo "# Clear all RBAC cache:"
echo "redis-cli KEYS 'rbac:*' | xargs redis-cli DEL"
echo ""

# Development commands
echo "🚀 DEVELOPMENT COMMANDS"
echo "----------------------"
echo "# Start dev server:"
echo "npm run start:dev"
echo ""
echo "# Watch mode:"
echo "npm run start:watch"
echo ""

# Debugging commands
echo "🔍 DEBUGGING COMMANDS"
echo "--------------------"
echo "# Check user permissions:"
echo "node -e \"
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const membership = await prisma.membership.findFirst({
    where: { userId: 'USER_ID', orgId: 'ORG_ID' },
    include: { user: true, organization: true }
  });
  console.log(membership);
  await prisma.\\\$disconnect();
})();
\""
echo ""
echo "# List all roles with permissions:"
echo "node -e \"
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const roles = await prisma.role.findMany({
    include: {
      permissions: {
        include: { permission: true }
      }
    }
  });
  roles.forEach(role => {
    console.log(\\\`\\\${role.name}: \\\${role.permissions.length} permissions\\\`);
  });
  await prisma.\\\$disconnect();
})();
\""
echo ""

# Quick fixes
echo "🔧 QUICK FIXES"
echo "-------------"
echo "# Regenerate Prisma Client:"
echo "npx prisma generate"
echo ""
echo "# Reset database (DANGER!):"
echo "npx prisma migrate reset"
echo ""
echo "# Fix cache issues - clear all:"
echo "redis-cli FLUSHDB"
echo ""

# Useful queries
echo "📊 USEFUL QUERIES"
echo "----------------"
echo "# Count permissions per role:"
echo "SELECT r.name, COUNT(rp.permission_id) as perm_count"
echo "FROM roles r"
echo "LEFT JOIN role_permissions rp ON r.id = rp.role_id"
echo "GROUP BY r.name;"
echo ""
echo "# List all active memberships:"
echo "SELECT u.email, o.name as org, m.role, m.status"
echo "FROM memberships m"
echo "JOIN users u ON m.user_id = u.id"
echo "JOIN organizations o ON m.org_id = o.id"
echo "WHERE m.status = 'ACTIVE';"
echo ""

echo "================================"
echo "📖 For full documentation, see:"
echo "   - /docs/13-RBAC_SETUP.md"
echo "   - /docs/14-RBAC_MIGRATION_GUIDE.md"
echo "   - /RBAC_IMPLEMENTATION_SUMMARY.md"
echo ""
