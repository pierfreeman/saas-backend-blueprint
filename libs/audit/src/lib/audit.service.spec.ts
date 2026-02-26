import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { PrismaService } from '@libs/prisma';
import {
  AUDIT_EVENTS,
  AUDIT_SEVERITY,
  DEFAULT_SEVERITY_MAP,
} from './audit-event-types.constants';
import type { AuditLogOptions } from './audit.types';

// ─── Mock Factories ───────────────────────────────────────────────────────────

const VALID_UUID_1 = 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789';
const VALID_UUID_2 = 'f1e2d3c4-b5a6-4987-8765-432101fedcba';

function makeAuditEvent(overrides: Partial<ReturnType<typeof baseEvent>> = {}) {
  return { ...baseEvent(), ...overrides };
}

function baseEvent() {
  return {
    id: VALID_UUID_1,
    type: 'org.created',
    severity: 'INFO',
    orgId: VALID_UUID_1,
    userId: VALID_UUID_2,
    payload: {},
    ipAddress: null,
    userAgent: null,
    correlationId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function buildPrismaMock() {
  return {
    auditEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AuditService', () => {
  let service: AuditService;
  let prisma: ReturnType<typeof buildPrismaMock>;

  beforeEach(async () => {
    prisma = buildPrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  afterEach(() => jest.clearAllMocks());

  // ─── logEvent ──────────────────────────────────────────────────────────────

  describe('logEvent', () => {
    it('persists an event and returns the record', async () => {
      const expected = makeAuditEvent();
      prisma.auditEvent.create.mockResolvedValue(expected);

      const result = await service.logEvent({
        type: AUDIT_EVENTS.ORGANIZATION.CREATED,
        orgId: VALID_UUID_1,
        userId: VALID_UUID_2,
        payload: { name: 'Acme' },
      });

      expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it('sanitises sensitive fields before persisting', async () => {
      const expected = makeAuditEvent();
      prisma.auditEvent.create.mockResolvedValue(expected);

      await service.logEvent({
        type: AUDIT_EVENTS.AUTH.LOGIN_SUCCESS,
        payload: { email: 'user@example.com', password: 'supersecret' },
      });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.payload.password).toBe('[REDACTED]');
      expect(createData.payload.email).toBe('user@example.com');
    });

    it('uses INFO severity when no severity mapping exists', async () => {
      prisma.auditEvent.create.mockResolvedValue(
        makeAuditEvent({ severity: 'INFO' }),
      );

      await service.logEvent({ type: 'custom.unknown.event' });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.severity).toBe(AUDIT_SEVERITY.INFO);
    });

    it('resolves HIGH severity for auth.login.failed from the default map', async () => {
      prisma.auditEvent.create.mockResolvedValue(
        makeAuditEvent({ severity: 'HIGH' }),
      );

      await service.logEvent({ type: AUDIT_EVENTS.AUTH.LOGIN_FAILED });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.severity).toBe('HIGH');
    });

    it('respects an explicit severity override', async () => {
      prisma.auditEvent.create.mockResolvedValue(
        makeAuditEvent({ severity: 'CRITICAL' }),
      );

      await service.logEvent({
        type: AUDIT_EVENTS.ORGANIZATION.DELETED,
        severity: 'CRITICAL',
      });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.severity).toBe('CRITICAL');
    });

    it('strips invalid orgId (non-UUID) to null', async () => {
      prisma.auditEvent.create.mockResolvedValue(
        makeAuditEvent({ orgId: null }),
      );

      await service.logEvent({
        type: AUDIT_EVENTS.ORGANIZATION.CREATED,
        orgId: 'not-a-uuid',
      });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.orgId).toBeNull();
    });

    it('strips invalid userId (non-UUID) to null', async () => {
      prisma.auditEvent.create.mockResolvedValue(
        makeAuditEvent({ userId: null }),
      );

      await service.logEvent({
        type: AUDIT_EVENTS.AUTH.LOGIN_SUCCESS,
        userId: 'bad-id',
      });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.userId).toBeNull();
    });

    it('accepts null orgId and userId (system events)', async () => {
      prisma.auditEvent.create.mockResolvedValue(
        makeAuditEvent({ orgId: null, userId: null }),
      );

      await service.logEvent({ type: AUDIT_EVENTS.SYSTEM.MAINTENANCE_STARTED });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.orgId).toBeNull();
      expect(createData.userId).toBeNull();
    });

    it('stores ipAddress, userAgent and correlationId', async () => {
      prisma.auditEvent.create.mockResolvedValue(makeAuditEvent());

      await service.logEvent({
        type: AUDIT_EVENTS.AUTH.LOGIN_SUCCESS,
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        correlationId: VALID_UUID_2,
      });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.ipAddress).toBe('192.168.1.1');
      expect(createData.userAgent).toBe('Mozilla/5.0');
      expect(createData.correlationId).toBe(VALID_UUID_2);
    });

    // Edge case: Prisma error must NOT propagate to the caller
    it('returns null and logs error when Prisma throws', async () => {
      prisma.auditEvent.create.mockRejectedValue(new Error('DB unavailable'));
      const loggerSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      const result = await service.logEvent({
        type: AUDIT_EVENTS.ORGANIZATION.CREATED,
      });

      expect(result).toBeNull();
      expect(loggerSpy).toHaveBeenCalled();
    });

    // Edge case: payload defaults to empty object
    it('defaults empty payload when none provided', async () => {
      prisma.auditEvent.create.mockResolvedValue(makeAuditEvent());

      await service.logEvent({ type: AUDIT_EVENTS.GDPR.DELETION_REQUESTED });

      const createData = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(createData.payload).toEqual({});
    });
  });

  // ─── logEventBackground ────────────────────────────────────────────────────

  describe('logEventBackground', () => {
    it('calls logEvent without awaiting (fire-and-forget)', () => {
      const logEventSpy = jest
        .spyOn(service, 'logEvent')
        .mockResolvedValue(null);

      service.logEventBackground({ type: AUDIT_EVENTS.AUTH.LOGOUT });

      expect(logEventSpy).toHaveBeenCalledTimes(1);
    });

    it('does not throw even if logEvent rejects', async () => {
      const loggerSpy = jest
        .spyOn(
          (service as unknown as { logger: { error: jest.Mock } }).logger,
          'error',
        )
        .mockImplementation(() => undefined);

      jest.spyOn(service, 'logEvent').mockRejectedValue(new Error('boom'));

      // Should not throw synchronously
      expect(() =>
        service.logEventBackground({ type: AUDIT_EVENTS.SECURITY.BLOCKED }),
      ).not.toThrow();

      // Drain the microtask queue so the .catch() handler runs
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(loggerSpy).toHaveBeenCalled();
    });
  });

  // ─── findByOrg ─────────────────────────────────────────────────────────────

  describe('findByOrg', () => {
    it('returns paginated events for an org', async () => {
      const events = [makeAuditEvent(), makeAuditEvent({ id: VALID_UUID_2 })];
      prisma.auditEvent.findMany.mockResolvedValue(events);
      prisma.auditEvent.count.mockResolvedValue(2);

      const result = await service.findByOrg(VALID_UUID_1, {
        limit: 10,
        offset: 0,
      });

      expect(result.total).toBe(2);
      expect(result.events).toHaveLength(2);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('applies typePrefix filter', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);
      prisma.auditEvent.count.mockResolvedValue(0);

      await service.findByOrg(VALID_UUID_1, { typePrefix: 'auth.' });

      const callWhere = prisma.auditEvent.findMany.mock.calls[0][0].where;
      expect(callWhere.type).toEqual({ startsWith: 'auth.' });
    });

    it('applies severity filter', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);
      prisma.auditEvent.count.mockResolvedValue(0);

      await service.findByOrg(VALID_UUID_1, { severity: 'HIGH' });

      const callWhere = prisma.auditEvent.findMany.mock.calls[0][0].where;
      expect(callWhere.severity).toBe('HIGH');
    });

    it('applies date range filter', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);
      prisma.auditEvent.count.mockResolvedValue(0);

      const from = new Date('2026-01-01');
      const to = new Date('2026-12-31');

      await service.findByOrg(VALID_UUID_1, { fromDate: from, toDate: to });

      const callWhere = prisma.auditEvent.findMany.mock.calls[0][0].where;
      expect(callWhere.createdAt).toEqual({ gte: from, lte: to });
    });

    it('uses default limit=100 and offset=0 when not provided', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);
      prisma.auditEvent.count.mockResolvedValue(0);

      const result = await service.findByOrg(VALID_UUID_1);

      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
    });
  });

  // ─── findByUser ────────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('returns paginated events for a user (GDPR Art. 15)', async () => {
      const events = [makeAuditEvent()];
      prisma.auditEvent.findMany.mockResolvedValue(events);
      prisma.auditEvent.count.mockResolvedValue(1);

      const result = await service.findByUser(VALID_UUID_2, { limit: 50 });

      expect(result.total).toBe(1);
      expect(result.events).toHaveLength(1);

      const callWhere = prisma.auditEvent.findMany.mock.calls[0][0].where;
      expect(callWhere.userId).toBe(VALID_UUID_2);
    });

    it('applies severity filter for user query', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);
      prisma.auditEvent.count.mockResolvedValue(0);

      await service.findByUser(VALID_UUID_2, { severity: 'CRITICAL' });

      const callWhere = prisma.auditEvent.findMany.mock.calls[0][0].where;
      expect(callWhere.severity).toBe('CRITICAL');
    });
  });

  // ─── findByType ────────────────────────────────────────────────────────────

  describe('findByType', () => {
    it('returns events for a specific type', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([
        makeAuditEvent({ type: 'org.deleted' }),
      ]);
      prisma.auditEvent.count.mockResolvedValue(1);

      const result = await service.findByType('org.deleted');

      expect(result.events[0].type).toBe('org.deleted');
    });
  });

  // ─── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all events with default pagination', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([makeAuditEvent()]);
      prisma.auditEvent.count.mockResolvedValue(1);

      const result = await service.findAll();

      expect(result.limit).toBe(100);
      expect(result.offset).toBe(0);
    });

    it('filters by typePrefix globally', async () => {
      prisma.auditEvent.findMany.mockResolvedValue([]);
      prisma.auditEvent.count.mockResolvedValue(0);

      await service.findAll({ typePrefix: 'gdpr.' });

      const callWhere = prisma.auditEvent.findMany.mock.calls[0][0].where;
      expect(callWhere.type).toEqual({ startsWith: 'gdpr.' });
    });
  });

  // ─── countByOrg ────────────────────────────────────────────────────────────

  describe('countByOrg', () => {
    it('returns the count for an org', async () => {
      prisma.auditEvent.count.mockResolvedValue(42);

      const count = await service.countByOrg(VALID_UUID_1);

      expect(count).toBe(42);
      expect(prisma.auditEvent.count).toHaveBeenCalledWith({
        where: { orgId: VALID_UUID_1 },
      });
    });
  });

  // ─── countByUser ───────────────────────────────────────────────────────────

  describe('countByUser', () => {
    it('returns the count for a user', async () => {
      prisma.auditEvent.count.mockResolvedValue(7);

      const count = await service.countByUser(VALID_UUID_2);

      expect(count).toBe(7);
      expect(prisma.auditEvent.count).toHaveBeenCalledWith({
        where: { userId: VALID_UUID_2 },
      });
    });
  });

  // ─── resolveSeverity ───────────────────────────────────────────────────────

  describe('resolveSeverity', () => {
    it('returns mapped severity for a known type', () => {
      expect(service.resolveSeverity('auth.login.failed')).toBe('HIGH');
      expect(service.resolveSeverity('org.deleted')).toBe('CRITICAL');
      expect(service.resolveSeverity('security.suspicious.activity')).toBe(
        'CRITICAL',
      );
    });

    it('returns INFO for an unknown event type', () => {
      expect(service.resolveSeverity('unknown.event')).toBe('INFO');
    });

    it('covers all entries in DEFAULT_SEVERITY_MAP', () => {
      for (const [type, expected] of Object.entries(DEFAULT_SEVERITY_MAP)) {
        expect(service.resolveSeverity(type)).toBe(expected);
      }
    });
  });

  // ─── sanitisePayload ───────────────────────────────────────────────────────

  describe('sanitisePayload', () => {
    it('redacts known sensitive fields', () => {
      const result = service.sanitisePayload({
        email: 'test@example.com',
        password: 'hunter2',
        apiKey: 'sk-abc',
        token: 'jwt-xyz',
      });

      expect(result.email).toBe('test@example.com');
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
    });

    it('recursively redacts nested sensitive fields', () => {
      const result = service.sanitisePayload({
        user: {
          name: 'Alice',
          credentials: {
            password: 'secret',
            twoFa: 'code',
          },
        },
      });

      expect((result.user as Record<string, unknown>)['name']).toBe('Alice');
      const credentials = (result.user as Record<string, unknown>)[
        'credentials'
      ] as Record<string, unknown>;
      expect(credentials['password']).toBe('[REDACTED]');
    });

    it('preserves non-sensitive and boolean/number values', () => {
      const result = service.sanitisePayload({
        organizationId: VALID_UUID_1,
        count: 5,
        active: true,
        tags: ['a', 'b'],
      });

      expect(result.organizationId).toBe(VALID_UUID_1);
      expect(result.count).toBe(5);
      expect(result.active).toBe(true);
      expect(result.tags).toEqual(['a', 'b']);
    });

    it('preserves Date objects without modification', () => {
      const date = new Date('2026-01-01');
      const result = service.sanitisePayload({ createdAt: date });

      expect(result.createdAt).toBe(date);
    });

    it('handles empty payload without throwing', () => {
      expect(() => service.sanitisePayload({})).not.toThrow();
    });

    it('stops recursion at depth > 5 to prevent stack overflow', () => {
      // depth=5 triggers the guard
      const result = service.sanitisePayload({ nested: {} }, 6);
      // Should return the payload unchanged
      expect(result).toEqual({ nested: {} });
    });

    it('does not throw on null values inside payload', () => {
      const result = service.sanitisePayload({ value: null, name: 'test' });
      expect(result.value).toBeNull();
      expect(result.name).toBe('test');
    });
  });

  // ─── toNullableUuid ────────────────────────────────────────────────────────

  describe('toNullableUuid', () => {
    it.each([
      [
        'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
        'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
      ],
      [
        'F1E2D3C4-B5A6-4987-8765-432101FEDCBA',
        'F1E2D3C4-B5A6-4987-8765-432101FEDCBA',
      ],
    ] as [string, string][])(
      'returns %s for a valid UUID',
      (input, expected) => {
        expect(service.toNullableUuid(input)).toBe(expected);
      },
    );

    it.each([
      'not-a-uuid',
      '123',
      '',
      '  ',
      'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    ])('returns null for invalid value "%s"', (input) => {
      expect(service.toNullableUuid(input)).toBeNull();
    });

    it('returns null for non-string types', () => {
      expect(service.toNullableUuid(null)).toBeNull();
      expect(service.toNullableUuid(undefined)).toBeNull();
      expect(service.toNullableUuid(123)).toBeNull();
      expect(service.toNullableUuid({})).toBeNull();
    });
  });

  // ─── GDPR / ISO compliance scenarios ──────────────────────────────────────

  describe('GDPR & ISO 27001 compliance scenarios', () => {
    beforeEach(() => {
      prisma.auditEvent.create.mockResolvedValue(makeAuditEvent());
    });

    it('logs a GDPR data deletion request with HIGH severity', async () => {
      await service.logEvent({
        type: AUDIT_EVENTS.GDPR.DELETION_REQUESTED,
        userId: VALID_UUID_2,
        payload: { requestedAt: new Date() },
      });

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.type).toBe('gdpr.data.deletion.requested');
      expect(data.severity).toBe('HIGH');
    });

    it('logs a GDPR data export with MEDIUM severity', async () => {
      await service.logEvent({
        type: AUDIT_EVENTS.GDPR.DATA_EXPORT_REQUESTED,
        userId: VALID_UUID_2,
      });

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.severity).toBe('MEDIUM');
    });

    it('logs a security brute force detection with CRITICAL severity', async () => {
      await service.logEvent({
        type: AUDIT_EVENTS.SECURITY.BRUTE_FORCE_DETECTED,
        ipAddress: '10.0.0.1',
        payload: { attempts: 50 },
      });

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.severity).toBe('CRITICAL');
      expect(data.ipAddress).toBe('10.0.0.1');
    });

    it('logs a consent revocation with orgId and userId', async () => {
      await service.logEvent({
        type: AUDIT_EVENTS.GDPR.CONSENT_REVOKED,
        orgId: VALID_UUID_1,
        userId: VALID_UUID_2,
        payload: { consentType: 'marketing' },
      });

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.orgId).toBe(VALID_UUID_1);
      expect(data.userId).toBe(VALID_UUID_2);
      expect((data.payload as Record<string, unknown>)['consentType']).toBe(
        'marketing',
      );
    });

    it('stores correlationId for distributed tracing', async () => {
      const correlationId = VALID_UUID_2;

      await service.logEvent({
        type: AUDIT_EVENTS.MEMBERSHIP.ROLE_CHANGED,
        correlationId,
        orgId: VALID_UUID_1,
      });

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect(data.correlationId).toBe(correlationId);
    });

    it('does not persist raw passwords even in GDPR events', async () => {
      await service.logEvent({
        type: AUDIT_EVENTS.USER.EMAIL_CHANGED,
        userId: VALID_UUID_2,
        payload: { newEmail: 'alice@example.com', password: 'changeme' },
      });

      const data = prisma.auditEvent.create.mock.calls[0][0].data;
      expect((data.payload as Record<string, unknown>)['password']).toBe(
        '[REDACTED]',
      );
    });
  });

  // ─── AUDIT_EVENTS constant completeness ────────────────────────────────────

  describe('AUDIT_EVENTS constants', () => {
    it('every AUTH event is a non-empty string', () => {
      for (const val of Object.values(AUDIT_EVENTS.AUTH)) {
        expect(typeof val).toBe('string');
        expect(val.length).toBeGreaterThan(0);
      }
    });

    it('every GDPR event starts with "gdpr."', () => {
      for (const val of Object.values(AUDIT_EVENTS.GDPR)) {
        expect(val).toMatch(/^gdpr\./);
      }
    });

    it('every SECURITY event starts with "security."', () => {
      for (const val of Object.values(AUDIT_EVENTS.SECURITY)) {
        expect(val).toMatch(/^security\./);
      }
    });
  });
});
