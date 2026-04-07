import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import {
  EntitlementOverrideRepository,
  EntitlementOverrideRow,
} from './entitlement-override.repository';
import { PrismaBusinessService } from '@libs/prisma-business';

const NOW = new Date('2026-04-01T00:00:00.000Z');
const FUTURE = new Date('2026-12-31T00:00:00.000Z');
const PAST = new Date('2025-01-01T00:00:00.000Z');

const makeRow = (
  overrides: Partial<EntitlementOverrideRow> = {},
): EntitlementOverrideRow => ({
  id: 'override-1',
  orgId: 'org-1',
  key: 'ssoEnabled',
  value: 'true',
  reason: 'Test',
  expiresAt: null,
  createdBy: 'admin-1',
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const makePrisma = (stubs: Record<string, unknown> = {}) =>
  ({
    entitlementOverride: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn(),
      delete: vi.fn(),
      ...stubs,
    },
  }) as unknown as PrismaBusinessService;

describe('EntitlementOverrideRepository', () => {
  let repo: EntitlementOverrideRepository;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(async () => {
    vi.clearAllMocks();
    prisma = makePrisma();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntitlementOverrideRepository,
        { provide: PrismaBusinessService, useValue: prisma },
      ],
    }).compile();
    repo = module.get(EntitlementOverrideRepository);
  });

  describe('findActiveByOrg()', () => {
    it('queries with non-expired filter and returns rows', async () => {
      const row = makeRow();
      prisma.entitlementOverride.findMany = vi.fn().mockResolvedValue([row]);

      const result = await repo.findActiveByOrg('org-1');

      expect(prisma.entitlementOverride.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ orgId: 'org-1' }),
        }),
      );
      expect(result).toEqual([row]);
    });
  });

  describe('findAllByOrg()', () => {
    it('returns all rows including expired, ordered by createdAt desc', async () => {
      const rows = [
        makeRow({ expiresAt: PAST }),
        makeRow({ id: 'override-2' }),
      ];
      prisma.entitlementOverride.findMany = vi.fn().mockResolvedValue(rows);

      const result = await repo.findAllByOrg('org-1');

      expect(prisma.entitlementOverride.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('upsert()', () => {
    it('calls prisma upsert with correct create and update payloads', async () => {
      const row = makeRow();
      prisma.entitlementOverride.upsert = vi.fn().mockResolvedValue(row);

      const result = await repo.upsert('org-1', {
        key: 'ssoEnabled',
        value: 'true',
        reason: 'Trial',
        expiresAt: null,
        createdBy: 'admin-1',
      });

      expect(prisma.entitlementOverride.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_key: { orgId: 'org-1', key: 'ssoEnabled' } },
          create: expect.objectContaining({ value: 'true', reason: 'Trial' }),
          update: expect.objectContaining({ value: 'true', reason: 'Trial' }),
        }),
      );
      expect(result).toBe(row);
    });
  });

  describe('delete()', () => {
    it('deletes when override exists', async () => {
      const row = makeRow();
      prisma.entitlementOverride.findUnique = vi.fn().mockResolvedValue(row);
      prisma.entitlementOverride.delete = vi.fn().mockResolvedValue(row);

      await repo.delete('org-1', 'ssoEnabled');

      expect(prisma.entitlementOverride.delete).toHaveBeenCalledWith({
        where: { orgId_key: { orgId: 'org-1', key: 'ssoEnabled' } },
      });
    });

    it('throws NotFoundException when override does not exist', async () => {
      prisma.entitlementOverride.findUnique = vi.fn().mockResolvedValue(null);

      await expect(repo.delete('org-1', 'ssoEnabled')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
