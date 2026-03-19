import { FeatureFlagsService } from './feature-flags.service';
import { BillingService } from '@libs/billing';
import { CacheService } from '@libs/redis';
import { LocalTransport, DOMAIN_EVENTS } from '@libs/events';
import { BillingStatus } from '@prisma/client';
import { OrganizationEntitlements } from './interfaces/entitlements.interface';

// ─── Constants ───────────────────────────────────────────────────────────────

const ORG_ID = 'org-uuid-001';
const PRICE_PRO = 'price_enterprise';
const PRICE_BASIC = 'price_pro';

// ─── Mock factories ───────────────────────────────────────────────────────────

const makeBillingService = (overrides?: {
  planId?: string | null;
  billingStatus?: BillingStatus;
}) =>
  ({
    getOrgBillingStatus: jest.fn().mockResolvedValue(
      overrides === undefined
        ? null
        : {
            planId: overrides.planId ?? null,
            billingStatus: overrides.billingStatus ?? BillingStatus.ACTIVE,
          },
    ),
  }) as unknown as BillingService;

const makeCache = (cached?: OrganizationEntitlements | null) =>
  ({
    get: jest.fn().mockResolvedValue(cached ?? null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  }) as unknown as CacheService;

const makeTransport = () => ({ on: jest.fn() }) as unknown as LocalTransport;

function buildService(
  billingService: BillingService,
  cache: CacheService,
  transport: LocalTransport,
): FeatureFlagsService {
  return new FeatureFlagsService(billingService, cache, transport);
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('FeatureFlagsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env['STRIPE_PRICE_ID_PRO'];
    delete process.env['STRIPE_PRICE_ID_BASIC'];
  });

  // ─── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('registers listeners for all relevant domain events', () => {
      const transport = makeTransport();
      const service = buildService(makeBillingService(), makeCache(), transport);

      service.onModuleInit();

      expect(transport.on).toHaveBeenCalledWith(
        DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        expect.any(Function),
      );
      expect(transport.on).toHaveBeenCalledWith(
        DOMAIN_EVENTS.BILLING_SUBSCRIPTION_CANCELLED,
        expect.any(Function),
      );
      expect(transport.on).toHaveBeenCalledWith(
        DOMAIN_EVENTS.SUBSCRIPTION_ACTIVATED,
        expect.any(Function),
      );
      expect(transport.on).toHaveBeenCalledWith(
        DOMAIN_EVENTS.SUBSCRIPTION_EXPIRED,
        expect.any(Function),
      );
      expect(transport.on).toHaveBeenCalledTimes(4);
    });

    it('the registered handler calls invalidateEntitlements with the orgId from the event payload', async () => {
      const cache = makeCache();
      const transport: { on: jest.Mock } = { on: jest.fn() };
      const service = buildService(
        makeBillingService(),
        cache,
        transport as unknown as LocalTransport,
      );

      service.onModuleInit();

      // Grab the handler registered for SUBSCRIPTION_PLAN_CHANGED
      const handler: (e: unknown) => Promise<void> =
        transport.on.mock.calls[0][1];

      await handler({
        eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        timestamp: new Date(),
        payload: { orgId: ORG_ID },
      });

      expect(cache.del).toHaveBeenCalledWith(`entitlements:${ORG_ID}`);
    });

    it('the handler is a no-op when payload contains no orgId', async () => {
      const cache = makeCache();
      const transport: { on: jest.Mock } = { on: jest.fn() };
      const service = buildService(
        makeBillingService(),
        cache,
        transport as unknown as LocalTransport,
      );

      service.onModuleInit();

      const handler: (e: unknown) => Promise<void> =
        transport.on.mock.calls[0][1];

      await handler({
        eventType: DOMAIN_EVENTS.SUBSCRIPTION_PLAN_CHANGED,
        timestamp: new Date(),
        payload: {},
      });

      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  // ─── getEntitlements ──────────────────────────────────────────────────────

  describe('getEntitlements()', () => {
    it('returns cached value without hitting the database', async () => {
      const cached: OrganizationEntitlements = {
        organizationId: ORG_ID,
        plan: 'PRO',
        subscriptionStatus: BillingStatus.ACTIVE,
        advancedAnalytics: true,
        customReports: true,
        apiAccess: true,
        ssoEnabled: false,
        prioritySupport: false,
      };
      const billingService = makeBillingService();
      const cache = makeCache(cached);
      const service = buildService(billingService, cache, makeTransport());

      const result = await service.getEntitlements(ORG_ID);

      expect(result).toEqual(cached);
      expect(billingService.getOrgBillingStatus).not.toHaveBeenCalled();
    });

    it('builds FREE entitlements when org has no subscription (null)', async () => {
      const billingService = makeBillingService(undefined); // returns null
      const cache = makeCache();
      const service = buildService(billingService, cache, makeTransport());

      const result = await service.getEntitlements(ORG_ID);

      expect(result.plan).toBe('FREE');
      expect(result.subscriptionStatus).toBe(BillingStatus.NONE);
      expect(result.advancedAnalytics).toBe(false);
      expect(cache.set).toHaveBeenCalledWith(
        `entitlements:${ORG_ID}`,
        result,
        expect.any(Number),
      );
    });

    it('downgrades to FREE when billingStatus is PAST_DUE regardless of plan', () => {
      process.env['STRIPE_PRICE_ID_PRO'] = PRICE_PRO;
      const billingService = makeBillingService({
        planId: PRICE_PRO,
        billingStatus: BillingStatus.PAST_DUE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      return service.getEntitlements(ORG_ID).then((result) => {
        expect(result.plan).toBe('FREE');
        expect(result.ssoEnabled).toBe(false);
      });
    });

    it('returns ENTERPRISE entitlements for ACTIVE + STRIPE_PRICE_ID_PRO plan', async () => {
      process.env['STRIPE_PRICE_ID_PRO'] = PRICE_PRO;
      const billingService = makeBillingService({
        planId: PRICE_PRO,
        billingStatus: BillingStatus.ACTIVE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      const result = await service.getEntitlements(ORG_ID);

      expect(result.plan).toBe('ENTERPRISE');
      expect(result.ssoEnabled).toBe(true);
      expect(result.prioritySupport).toBe(true);
    });

    it('returns PRO entitlements for ACTIVE + STRIPE_PRICE_ID_BASIC plan', async () => {
      process.env['STRIPE_PRICE_ID_BASIC'] = PRICE_BASIC;
      const billingService = makeBillingService({
        planId: PRICE_BASIC,
        billingStatus: BillingStatus.ACTIVE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      const result = await service.getEntitlements(ORG_ID);

      expect(result.plan).toBe('PRO');
      expect(result.advancedAnalytics).toBe(true);
      expect(result.ssoEnabled).toBe(false);
    });

    it('returns FREE when ACTIVE but planId matches no known price', async () => {
      const billingService = makeBillingService({
        planId: 'price_unknown',
        billingStatus: BillingStatus.ACTIVE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      const result = await service.getEntitlements(ORG_ID);

      expect(result.plan).toBe('FREE');
    });

    it('stores result in cache after DB fetch', async () => {
      const cache = makeCache();
      const service = buildService(makeBillingService({}), cache, makeTransport());

      const result = await service.getEntitlements(ORG_ID);

      expect(cache.set).toHaveBeenCalledWith(
        `entitlements:${ORG_ID}`,
        result,
        expect.any(Number),
      );
    });
  });

  // ─── setEntitlements ──────────────────────────────────────────────────────

  describe('setEntitlements()', () => {
    it('writes the provided entitlements directly into the cache', async () => {
      const cache = makeCache();
      const service = buildService(makeBillingService(), cache, makeTransport());

      const entitlements: OrganizationEntitlements = {
        organizationId: ORG_ID,
        plan: 'ENTERPRISE',
        subscriptionStatus: BillingStatus.ACTIVE,
        advancedAnalytics: true,
        customReports: true,
        apiAccess: true,
        ssoEnabled: true,
        prioritySupport: true,
      };

      await service.setEntitlements(ORG_ID, entitlements);

      expect(cache.set).toHaveBeenCalledWith(
        `entitlements:${ORG_ID}`,
        entitlements,
        expect.any(Number),
      );
    });
  });

  // ─── checkFeature ─────────────────────────────────────────────────────────

  describe('checkFeature()', () => {
    it('returns false for a feature not included in the FREE plan', async () => {
      const billingService = makeBillingService({});
      const service = buildService(billingService, makeCache(), makeTransport());

      expect(await service.checkFeature(ORG_ID, 'advancedAnalytics')).toBe(false);
    });

    it('returns true for a feature enabled in the ENTERPRISE plan', async () => {
      process.env['STRIPE_PRICE_ID_PRO'] = PRICE_PRO;
      const billingService = makeBillingService({
        planId: PRICE_PRO,
        billingStatus: BillingStatus.ACTIVE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      expect(await service.checkFeature(ORG_ID, 'ssoEnabled')).toBe(true);
    });

    it('uses cached entitlements on repeated calls', async () => {
      const cached: OrganizationEntitlements = {
        organizationId: ORG_ID,
        plan: 'PRO',
        subscriptionStatus: BillingStatus.ACTIVE,
        advancedAnalytics: true,
        customReports: true,
        apiAccess: true,
        ssoEnabled: false,
        prioritySupport: false,
      };
      const billingService = makeBillingService();
      const cache = makeCache(cached);
      const service = buildService(billingService, cache, makeTransport());

      const first = await service.checkFeature(ORG_ID, 'apiAccess');
      const second = await service.checkFeature(ORG_ID, 'apiAccess');

      expect(first).toBe(true);
      expect(second).toBe(true);
      expect(billingService.getOrgBillingStatus).not.toHaveBeenCalled();
    });
  });

  // ─── checkLimit ───────────────────────────────────────────────────────────

  describe('checkLimit()', () => {
    it('allows creation when current count is below FREE limit', async () => {
      const service = buildService(makeBillingService({}), makeCache(), makeTransport());

      const result = await service.checkLimit(ORG_ID, 'maxTeams', 1);

      expect(result).toEqual({ allowed: true, limit: 2, current: 1 });
    });

    it('denies creation when current count equals FREE limit', async () => {
      const service = buildService(makeBillingService({}), makeCache(), makeTransport());

      const result = await service.checkLimit(ORG_ID, 'maxTeams', 2);

      expect(result).toEqual({ allowed: false, limit: 2, current: 2 });
    });

    it('allows creation against the PRO maxPlayers limit', async () => {
      process.env['STRIPE_PRICE_ID_BASIC'] = PRICE_BASIC;
      const billingService = makeBillingService({
        planId: PRICE_BASIC,
        billingStatus: BillingStatus.ACTIVE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      const result = await service.checkLimit(ORG_ID, 'maxPlayers', 150);

      expect(result).toEqual({ allowed: true, limit: 200, current: 150 });
    });

    it('ENTERPRISE plan has virtually unlimited teams', async () => {
      process.env['STRIPE_PRICE_ID_PRO'] = PRICE_PRO;
      const billingService = makeBillingService({
        planId: PRICE_PRO,
        billingStatus: BillingStatus.ACTIVE,
      });
      const service = buildService(billingService, makeCache(), makeTransport());

      const result = await service.checkLimit(ORG_ID, 'maxTeams', 500);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(999999);
    });
  });

  // ─── invalidateEntitlements ───────────────────────────────────────────────

  describe('invalidateEntitlements()', () => {
    it('deletes the correct Redis key', async () => {
      const cache = makeCache();
      const service = buildService(makeBillingService(), cache, makeTransport());

      await service.invalidateEntitlements(ORG_ID);

      expect(cache.del).toHaveBeenCalledWith(`entitlements:${ORG_ID}`);
    });
  });
});
