import { Test, TestingModule } from '@nestjs/testing';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { MembershipsService } from '../../src/modules/memberships/memberships.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { TestDatabase } from '../setup/test-db';
import { PrismaClient, MembershipRole } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('OrganizationsService Integration Tests', () => {
  let testDb: TestDatabase;
  let prisma: PrismaClient;
  let module: TestingModule;
  let organizationsService: OrganizationsService;
  let _membershipsService: MembershipsService;

  beforeAll(async () => {
    testDb = new TestDatabase();
    await testDb.start();
    prisma = testDb.getPrisma();

    module = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        {
          provide: MembershipsService,
          useValue: {},
        },
        {
          provide: EventBusService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
      ],
    }).compile();

    organizationsService = module.get<OrganizationsService>(OrganizationsService);
    _membershipsService = module.get<MembershipsService>(MembershipsService);
  });

  afterAll(async () => {
    await module?.close();
    await testDb?.stop();
  });

  beforeEach(async () => {
    // Clean database before each test
    await prisma.membership.deleteMany();
    await prisma.team.deleteMany();
    await prisma.player.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('createOrganization', () => {
    it('should persist organization to database', async () => {
      const userId = '11111111-1111-4111-8111-111111111111';
      const orgData = {
        name: 'Test Organization',
      };

      // Create user first
      await prisma.user.create({
        data: {
          id: userId,
          auth0Id: `auth0|test`,
          email: 'test@example.com',
        },
      });

      const result = await organizationsService.createOrganization(userId, orgData);

      // Verify organization persisted
      const dbOrg = await prisma.organization.findUnique({
        where: { id: result.id },
      });

      expect(dbOrg).toBeDefined();
      expect(dbOrg?.name).toBe(orgData.name);
      expect(dbOrg?.status).toBe('ACTIVE');
    });

    it('should automatically create OWNER membership', async () => {
      const userId = '22222222-2222-4222-8222-222222222222';
      const orgData = {
        name: 'Owner Test Org',
      };

      await prisma.user.create({
        data: {
          id: userId,
          auth0Id: `auth0|owner`,
          email: 'owner@example.com',
        },
      });

      const org = await organizationsService.createOrganization(userId, orgData);

      // Verify OWNER membership exists
      const membership = await prisma.membership.findFirst({
        where: {
          userId,
          orgId: org.id,
        },
      });

      expect(membership).toBeDefined();
      expect(membership?.role).toBe(MembershipRole.OWNER);
    });

    it('should allow same user to create multiple organizations', async () => {
      const userId = '33333333-3333-4333-8333-333333333333';
      await prisma.user.create({
        data: {
          id: userId,
          auth0Id: `auth0|unique`,
          email: 'unique@example.com',
        },
      });

      const orgData = { name: 'Org 1' };

      const org1 = await organizationsService.createOrganization(userId, orgData);

      // Create another org with same user (should work)
      const org2 = await organizationsService.createOrganization(userId, {
        name: 'Org 2',
      });

      expect(org1.id).not.toBe(org2.id);
    });
  });

  describe('updateOrganization', () => {
    it('should persist updates to database', async () => {
      const userId = '44444444-4444-4444-8444-444444444444';
      await prisma.user.create({
        data: { id: userId, auth0Id: `auth0|update`, email: 'update@example.com' },
      });

      const org = await organizationsService.createOrganization(userId, {
        name: 'Original Name',
      });

      const updates = {
        name: 'Updated Name',
      };

      await organizationsService.updateOrganization(org.id, updates);

      const dbOrg = await prisma.organization.findUnique({
        where: { id: org.id },
      });

      expect(dbOrg?.name).toBe('Updated Name');
    });
  });

  describe('deleteOrganization', () => {
    it('should delete organization from database', async () => {
      const userId = '55555555-5555-4555-8555-555555555555';
      await prisma.user.create({
        data: { id: userId, auth0Id: `auth0|delete`, email: 'delete@example.com' },
      });

      const org = await organizationsService.createOrganization(userId, {
        name: 'To Delete',
      });

      await organizationsService.deleteOrganization(org.id);

      const dbOrg = await prisma.organization.findUnique({
        where: { id: org.id },
      });

      expect(dbOrg).toBeNull();
    });
  });

  describe('findByUserId', () => {
    it('should return only organizations user has membership in', async () => {
      const user1 = '66666666-6666-4666-8666-666666666666';
      const user2 = '77777777-7777-4777-8777-777777777777';

      await prisma.user.createMany({
        data: [
          { id: user1, auth0Id: `auth0|member`, email: 'member@example.com' },
          { id: user2, auth0Id: `auth0|other`, email: 'other@example.com' },
        ],
      });

      // Create org1 with user1 as owner
      const org1 = await organizationsService.createOrganization(user1, {
        name: 'Org 1',
      });

      // Create org2 with user2 as owner
      await organizationsService.createOrganization(user2, {
        name: 'Org 2',
      });

      const user1Orgs = await organizationsService.findByUserId(user1);

      expect(user1Orgs).toHaveLength(1);
      expect(user1Orgs[0].id).toBe(org1.id);
    });
  });
});
