import { Test, TestingModule } from '@nestjs/testing';
import { TeamsService } from '../../src/modules/teams/teams.service';
import { TestDatabase } from '../setup/test-db';
import { PrismaClient, MembershipRole } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { FeatureFlagsService } from '../../src/modules/feature-flags/feature-flags.service';

describe('TeamsService Integration Tests', () => {
  let testDb: TestDatabase;
  let prisma: PrismaClient;
  let module: TestingModule;
  let teamsService: TeamsService;
  let featureFlagsService: { checkLimit: jest.Mock };

  let userId: string;
  let org1Id: string;
  let org2Id: string;

  beforeAll(async () => {
    testDb = new TestDatabase();
    await testDb.start();
    prisma = testDb.getPrisma();
    featureFlagsService = {
      checkLimit: jest.fn().mockResolvedValue({
        allowed: true,
        limit: null,
        current: 0,
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        TeamsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: EventBusService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: FeatureFlagsService,
          useValue: featureFlagsService,
        },
      ],
    }).compile();

    teamsService = module.get<TeamsService>(TeamsService);
  });

  afterAll(async () => {
    await module?.close();
    await testDb?.stop();
  });

  beforeEach(async () => {
    featureFlagsService.checkLimit.mockResolvedValue({
      allowed: true,
      limit: null,
      current: 0,
    });

    // Clean database
    await prisma.membership.deleteMany();
    await prisma.team.deleteMany();
    await prisma.player.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    // Setup test data
    userId = '11111111-1111-4111-8111-111111111111';
    await prisma.user.create({
      data: {
        id: userId,
        auth0Id: `auth0|teams`,
        email: 'teams@example.com',
      },
    });

    // Create two organizations
    const org1 = await prisma.organization.create({
      data: { name: 'Organization 1' },
    });
    org1Id = org1.id;

    const org2 = await prisma.organization.create({
      data: { name: 'Organization 2' },
    });
    org2Id = org2.id;

    // Add user as ADMIN to org1
    await prisma.membership.create({
      data: {
        userId,
        orgId: org1Id,
        role: MembershipRole.ADMIN,
      },
    });
  });

  describe('createTeam', () => {
    it('should persist team to database with correct organizationId', async () => {
      const teamData = {
        name: 'Team A',
      };

      const team = await teamsService.createTeam(org1Id, teamData);

      const dbTeam = await prisma.team.findUnique({
        where: { id: team.id },
      });

      expect(dbTeam).toBeDefined();
      expect(dbTeam?.name).toBe(teamData.name);
      expect(dbTeam?.orgId).toBe(org1Id);
    });

    it('should allow multiple teams in same organization', async () => {
      await teamsService.createTeam(org1Id, {
        name: 'Team 1',
      });
      await teamsService.createTeam(org1Id, {
        name: 'Team 2',
      });

      const teams = await prisma.team.findMany({
        where: { orgId: org1Id },
      });

      expect(teams).toHaveLength(2);
    });
  });

  describe('findAllByOrg', () => {
    it('should return only teams belonging to specified organization', async () => {
      // Create teams in org1
      await teamsService.createTeam(org1Id, {
        name: 'Org1 Team',
      });

      // Create team in org2
      await teamsService.createTeam(org2Id, {
        name: 'Org2 Team',
      });

      const org1Teams = await teamsService.findAllByOrg(org1Id);
      const org2Teams = await teamsService.findAllByOrg(org2Id);

      expect(org1Teams).toHaveLength(1);
      expect(org1Teams[0].name).toBe('Org1 Team');

      expect(org2Teams).toHaveLength(1);
      expect(org2Teams[0].name).toBe('Org2 Team');
    });

    it('should not expose teams from other organizations', async () => {
      const team1 = await teamsService.createTeam(org1Id, {
        name: 'Team 1',
      });

      await teamsService.createTeam(org2Id, {
        name: 'Team 2',
      });

      // Verify org2 can't see org1 teams
      const org2Teams = await teamsService.findAllByOrg(org2Id);

      expect(org2Teams).not.toContainEqual(expect.objectContaining({ id: team1.id }));
    });
  });

  describe('findById', () => {
    it('should verify team belongs to organization', async () => {
      const team = await teamsService.createTeam(org1Id, {
        name: 'Test Team',
      });

      // Correct org
      const result = await teamsService.findById(team.id, org1Id);
      expect(result.id).toBe(team.id);

      // Wrong org should throw
      await expect(teamsService.findById(team.id, org2Id)).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTeam', () => {
    it('should only update team if it belongs to organization', async () => {
      const team = await teamsService.createTeam(org1Id, {
        name: 'Original Name',
      });

      // Update with correct org
      await teamsService.updateTeam(team.id, org1Id, { name: 'Updated Name' });

      const dbTeam = await prisma.team.findUnique({ where: { id: team.id } });
      expect(dbTeam?.name).toBe('Updated Name');

      // Update with wrong org should fail
      await expect(
        teamsService.updateTeam(team.id, org2Id, { name: 'Hacked Name' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteTeam', () => {
    it('should delete team only if it belongs to organization', async () => {
      const team = await teamsService.createTeam(org1Id, {
        name: 'To Delete',
      });

      // Delete with wrong org should fail
      await expect(teamsService.deleteTeam(team.id, org2Id)).rejects.toThrow(NotFoundException);

      // Delete with correct org
      await teamsService.deleteTeam(team.id, org1Id);

      const dbTeam = await prisma.team.findUnique({ where: { id: team.id } });
      expect(dbTeam).toBeNull();
    });
  });

  describe('Cross-organization isolation', () => {
    it('should prevent access to teams from different organizations', async () => {
      const team1 = await teamsService.createTeam(org1Id, {
        name: 'Org1 Team',
      });

      // Attempt to access org1 team from org2 context
      await expect(teamsService.findById(team1.id, org2Id)).rejects.toThrow(NotFoundException);

      // Attempt to update org1 team from org2 context
      await expect(teamsService.updateTeam(team1.id, org2Id, { name: 'Hacked' })).rejects.toThrow(
        NotFoundException,
      );

      // Attempt to delete org1 team from org2 context
      await expect(teamsService.deleteTeam(team1.id, org2Id)).rejects.toThrow(NotFoundException);
    });
  });
});
