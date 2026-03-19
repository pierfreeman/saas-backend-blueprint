import { Test, TestingModule } from '@nestjs/testing';
import { LegalAuditService } from './legal-audit.service';
import { PrismaLegalService } from '@libs/prisma-legal';

// ─── Helpers ────────────────────────────────────────────────────────────────
const ORG_UUID = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';

function buildPrismaLegalMock() {
  return {
    auditEvent: {
      create: jest.fn().mockResolvedValue({ id: 'legal-id' }),
    },
  };
}

describe('LegalAuditService', () => {
  let service: LegalAuditService;
  let prismaLegal: ReturnType<typeof buildPrismaLegalMock>;

  beforeEach(async () => {
    prismaLegal = buildPrismaLegalMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LegalAuditService,
        { provide: PrismaLegalService, useValue: prismaLegal },
      ],
    }).compile();

    service = module.get<LegalAuditService>(LegalAuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── recordEvent ────────────────────────────────────────────────────────────

  describe('recordEvent', () => {
    it('calls prismaLegal.auditEvent.create with correct fields', async () => {
      service.recordEvent({
        eventType: 'org.created',
        orgId: ORG_UUID,
        actorRole: 'OWNER',
        triggerType: 'user_action',
        metadata: { organizationId: ORG_UUID },
      });

      await new Promise(process.nextTick);

      expect(prismaLegal.auditEvent.create).toHaveBeenCalledTimes(1);
      const data = prismaLegal.auditEvent.create.mock.calls[0][0].data;
      expect(data.eventType).toBe('org.created');
      expect(data.orgId).toBe(ORG_UUID);
      expect(data.actorRole).toBe('OWNER');
      expect(data.triggerType).toBe('user_action');
      expect(data.metadata).toEqual({ organizationId: ORG_UUID });
    });

    it('does not throw when prismaLegal.auditEvent.create rejects (fire-and-forget)', async () => {
      prismaLegal.auditEvent.create.mockRejectedValueOnce(
        new Error('Legal DB unavailable'),
      );

      expect(() =>
        service.recordEvent({ eventType: 'org.deleted' }),
      ).not.toThrow();

      await new Promise(process.nextTick);
    });

    it('calls logger.error when create rejects', async () => {
      prismaLegal.auditEvent.create.mockRejectedValueOnce(
        new Error('Legal DB unavailable'),
      );
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);

      service.recordEvent({ eventType: 'org.deleted' });
      await new Promise(process.nextTick);

      expect(loggerSpy).toHaveBeenCalled();
    });

    it('stores null orgId when orgId is not provided', async () => {
      service.recordEvent({ eventType: 'system.config.changed' });
      await new Promise(process.nextTick);

      const data = prismaLegal.auditEvent.create.mock.calls[0][0].data;
      expect(data.orgId).toBeNull();
    });

    it('defaults metadata to {} when not provided', async () => {
      service.recordEvent({ eventType: 'org.suspended', orgId: ORG_UUID });
      await new Promise(process.nextTick);

      const data = prismaLegal.auditEvent.create.mock.calls[0][0].data;
      expect(data.metadata).toEqual({});
    });

    it('does not expose any query or read methods', () => {
      expect((service as any).findBy).toBeUndefined();
      expect((service as any).findAll).toBeUndefined();
      expect((service as any).count).toBeUndefined();
    });
  });
});
