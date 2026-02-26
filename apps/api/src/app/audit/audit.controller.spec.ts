import { AuditController } from './audit.controller';
import { AuditService } from '@libs/audit';
import type { PaginatedAuditResult } from '@libs/audit';
import { AuditQueryDto } from './dto/audit-query.dto';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ORG_ID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';

function buildPage(
  overrides: Partial<PaginatedAuditResult> = {},
): PaginatedAuditResult {
  return {
    events: [],
    total: 0,
    limit: 100,
    offset: 0,
    ...overrides,
  };
}

const mockAuditService = {
  findByOrg: jest.fn(),
} as unknown as AuditService;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AuditController', () => {
  let controller: AuditController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuditController(mockAuditService);
  });

  // ── happy paths ─────────────────────────────────────────────────────────────

  describe('getAuditLog()', () => {
    it('returns the paginated result from AuditService', async () => {
      const page = buildPage({ total: 3 });
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(page);

      const result = await controller.getAuditLog(ORG_ID, {});

      expect(result).toBe(page);
    });

    it('calls findByOrg with default limit=100 and offset=0 when no params given', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {});

      expect(mockAuditService.findByOrg).toHaveBeenCalledWith(ORG_ID, {
        limit: 100,
        offset: 0,
        typePrefix: undefined,
        severity: undefined,
        fromDate: undefined,
        toDate: undefined,
      });
    });

    it('passes explicit limit and offset to service', async () => {
      mockAuditService.findByOrg = jest
        .fn()
        .mockResolvedValue(buildPage({ limit: 20, offset: 40 }));

      await controller.getAuditLog(ORG_ID, {
        limit: 20,
        offset: 40,
      } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.limit).toBe(20);
      expect(opts.offset).toBe(40);
    });

    it('clamps limit to 500 when a higher value is supplied', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, { limit: 9999 } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.limit).toBe(500);
    });

    it('passes typePrefix filter to service', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {
        typePrefix: 'auth.',
      } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.typePrefix).toBe('auth.');
    });

    it('passes severity filter to service', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {
        severity: 'HIGH',
      } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.severity).toBe('HIGH');
    });

    it('parses ISO fromDate string into a Date object', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {
        fromDate: '2026-01-01T00:00:00Z',
      } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.fromDate).toBeInstanceOf(Date);
      expect(opts.fromDate?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    });

    it('parses ISO toDate string into a Date object', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {
        toDate: '2026-12-31T23:59:59Z',
      } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.toDate).toBeInstanceOf(Date);
      expect(opts.toDate?.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    });

    it('passes both fromDate and toDate when both are provided', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {
        fromDate: '2026-01-01T00:00:00Z',
        toDate: '2026-06-30T23:59:59Z',
      } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.fromDate).toBeInstanceOf(Date);
      expect(opts.toDate).toBeInstanceOf(Date);
    });

    it('returns fromDate=undefined when no fromDate string is supplied', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {});

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.fromDate).toBeUndefined();
    });

    it('passes all filters simultaneously', async () => {
      const page = buildPage({ total: 1 });
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(page);

      const result = await controller.getAuditLog(ORG_ID, {
        limit: 25,
        offset: 50,
        typePrefix: 'gdpr.',
        severity: 'CRITICAL',
        fromDate: '2026-01-01T00:00:00Z',
        toDate: '2026-12-31T23:59:59Z',
      } as AuditQueryDto);

      expect(result).toBe(page);
      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts).toEqual({
        limit: 25,
        offset: 50,
        typePrefix: 'gdpr.',
        severity: 'CRITICAL',
        fromDate: new Date('2026-01-01T00:00:00Z'),
        toDate: new Date('2026-12-31T23:59:59Z'),
      });
    });
  });

  // ── edge cases ──────────────────────────────────────────────────────────────

  describe('getAuditLog() – edge cases', () => {
    it('treats empty-string typePrefix as undefined', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, { typePrefix: '' } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      // falsy empty string → coerced to undefined
      expect(opts.typePrefix).toBeUndefined();
    });

    it('uses limit=100 when limit is absent from the DTO', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {});

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.limit).toBe(100);
    });

    it('uses offset=0 when offset is absent from the DTO', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, {});

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.offset).toBe(0);
    });

    it('propagates service errors to the caller', async () => {
      mockAuditService.findByOrg = jest
        .fn()
        .mockRejectedValue(new Error('DB unavailable'));

      await expect(controller.getAuditLog(ORG_ID, {})).rejects.toThrow(
        'DB unavailable',
      );
    });

    it('returns an empty events array when no records exist', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      const result = await controller.getAuditLog(ORG_ID, {});

      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('exactly caps limit at 500 (boundary value)', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, { limit: 500 } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.limit).toBe(500);
    });

    it('does not cap limit=499 (one below boundary)', async () => {
      mockAuditService.findByOrg = jest.fn().mockResolvedValue(buildPage());

      await controller.getAuditLog(ORG_ID, { limit: 499 } as AuditQueryDto);

      const opts = (mockAuditService.findByOrg as jest.Mock).mock.calls[0][1];
      expect(opts.limit).toBe(499);
    });
  });

  // ── guard & decorator metadata (structural checks) ─────────────────────────

  describe('route metadata', () => {
    it('controller class is defined', () => {
      expect(controller).toBeDefined();
    });

    it('getAuditLog method is defined', () => {
      expect(typeof controller.getAuditLog).toBe('function');
    });

    it('controller only exposes a single public method (read-only, no write routes)', () => {
      const publicMethods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(controller),
      ).filter((m) => m !== 'constructor');

      expect(publicMethods).toEqual(['getAuditLog']);
    });
  });
});
