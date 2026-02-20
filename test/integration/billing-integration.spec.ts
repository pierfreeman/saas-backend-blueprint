import { Test, TestingModule } from '@nestjs/testing';
import { BillingService } from '../../src/modules/billing/billing.service';
import { EventBusService } from '../../src/events/event-bus.service';
import { TestDatabase } from '../setup/test-db';
import { PrismaClient, SubscriptionPlan, SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StripeService } from '../../src/modules/billing/stripe.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('BillingService Integration Tests', () => {
  let testDb: TestDatabase;
  let prisma: PrismaClient;
  let module: TestingModule;
  let billingService: BillingService;
  let eventBus: EventBusService;

  let mockStripeService: any;

  beforeAll(async () => {
    testDb = new TestDatabase();
    await testDb.start();
    prisma = testDb.getPrisma();

    mockStripeService = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      createBillingPortalSession: jest.fn(),
      cancelSubscription: jest.fn(),
      reactivateSubscription: jest.fn(),
    };

    module = await Test.createTestingModule({
      providers: [
        BillingService,
        EventBusService,
        {
          provide: EventEmitter2,
          useValue: new EventEmitter2(),
        },
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: StripeService,
          useValue: mockStripeService,
        },
      ],
    }).compile();

    billingService = module.get<BillingService>(BillingService);
    eventBus = module.get<EventBusService>(EventBusService);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
    if (testDb) {
      await testDb.stop();
    }
  });

  beforeEach(async () => {
    // Clean database
    await prisma.subscription.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    jest.clearAllMocks();
  });

  describe('Subscription Management', () => {
    it('should set cancelAtPeriodEnd when cancelSubscription is called', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Cancel Test Org',
          stripeCustomerId: 'cus_cancel',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          orgId: org.id,
          stripeSubscriptionId: 'sub_cancel_123',
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-03-11'),
          cancelAtPeriodEnd: false,
        },
      });

      mockStripeService.cancelSubscription.mockResolvedValue({ id: 'sub_cancel_123' });

      await billingService.cancelSubscription(org.id, true);

      const updated = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });

      expect(updated?.cancelAtPeriodEnd).toBe(true);
      expect(mockStripeService.cancelSubscription).toHaveBeenCalledWith('sub_cancel_123', true);
    });

    it('should reactivate subscription when scheduled for cancellation', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Reactivate Test Org',
          stripeCustomerId: 'cus_reactivate',
        },
      });

      const subscription = await prisma.subscription.create({
        data: {
          orgId: org.id,
          stripeSubscriptionId: 'sub_reactivate_123',
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-03-11'),
          cancelAtPeriodEnd: true,
        },
      });

      mockStripeService.reactivateSubscription.mockResolvedValue({ id: 'sub_reactivate_123' });

      await billingService.reactivateSubscription(org.id);

      const updated = await prisma.subscription.findUnique({
        where: { id: subscription.id },
      });

      expect(updated?.cancelAtPeriodEnd).toBe(false);
      expect(mockStripeService.reactivateSubscription).toHaveBeenCalledWith('sub_reactivate_123');
    });

    it('should throw when reactivating subscription not scheduled for cancellation', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Reactivate Invalid Org',
          stripeCustomerId: 'cus_reactivate_invalid',
        },
      });

      await prisma.subscription.create({
        data: {
          orgId: org.id,
          stripeSubscriptionId: 'sub_reactivate_invalid',
          plan: SubscriptionPlan.PRO,
          status: SubscriptionStatus.ACTIVE,
          currentPeriodEnd: new Date('2026-03-11'),
          cancelAtPeriodEnd: false,
        },
      });

      await expect(billingService.reactivateSubscription(org.id)).rejects.toThrow(
        'Subscription is not scheduled for cancellation',
      );
    });
  });

  describe('createStripeCustomer', () => {
    it('should persist stripeCustomerId to organization', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Customer Test',
        },
      });

      mockStripeService.createCustomer.mockResolvedValue({
        id: 'cus_new123',
      });

      const orgFromDb = await prisma.organization.findUnique({
        where: { id: org.id },
      });

      if (!orgFromDb) throw new Error('Org not found');

      await billingService.createStripeCustomer(orgFromDb);

      const updatedOrg = await prisma.organization.findUnique({
        where: { id: org.id },
      });

      expect(updatedOrg?.stripeCustomerId).toBe('cus_new123');
    });
  });

  describe('getOrCreateStripeCustomer', () => {
    it('should return existing stripeCustomerId if present', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'Existing Customer',
          stripeCustomerId: 'cus_existing',
        },
      });

      const customerId = await billingService.getOrCreateStripeCustomer(org.id);

      expect(customerId).toBe('cus_existing');
      expect(mockStripeService.createCustomer).not.toHaveBeenCalled();
    });

    it('should create new customer if stripeCustomerId is null', async () => {
      const org = await prisma.organization.create({
        data: {
          name: 'New Customer',
        },
      });

      mockStripeService.createCustomer.mockResolvedValue({
        id: 'cus_created',
      });

      const customerId = await billingService.getOrCreateStripeCustomer(org.id);

      expect(customerId).toBe('cus_created');
      expect(mockStripeService.createCustomer).toHaveBeenCalled();

      const updatedOrg = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(updatedOrg?.stripeCustomerId).toBe('cus_created');
    });
  });
});
