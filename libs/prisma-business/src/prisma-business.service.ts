import {
  Injectable,
  OnModuleInit,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import {
  getCurrentTenantOrgId,
  getCurrentTenantUserId,
  isSystemLookup,
} from './tenant-context';

/**
 * Model delegate accessor names (client property names, camelCase) that
 * are subject to Row-Level Security — see
 * prisma/migrations/20260808120000_enable_row_level_security. Every call
 * through one of these delegates is wrapped in its own short-lived
 * transaction that sets the `app.current_org_id` Postgres session variable
 * from the current tenant context (see tenant-context.ts) before
 * delegating to the real query, so RLS policies see the right value.
 *
 * Keep in sync with the RLS migration's table list.
 */
const TENANT_SCOPED_MODELS = [
  'organization',
  'membership',
  'file',
  'job',
  'orgExport',
  'notification',
  'entitlementOverride',
  'billingEvent',
  'subscriptionSnapshot',
  'event',
  'eventAttendee',
  'eventOccurrenceAttendee',
  'eventException',
  'activityLog',
] as const;

/**
 * PrismaBusinessService
 * Provides access to the business PostgreSQL database.
 * Manages the Prisma connection lifecycle for domain models:
 * User, Organization, Membership, ActivityLog, and Job.
 *
 * Extends PrismaClient directly so all generated model accessors
 * (e.g. this.user, this.organization, this.activityLog) are available on the service.
 *
 * Tenant isolation: `onModuleInit` wraps every TENANT_SCOPED_MODELS
 * delegate (this.membership, this.job, ...) in a Proxy that opens a short
 * `$transaction`, sets `app.current_org_id` for the current tenant context,
 * then dispatches the real operation — backing the RLS policies with zero
 * call-site changes in repositories (`this.prisma.membership.findMany(...)`
 * keeps working unchanged).
 *
 * This is deliberately NOT implemented via a Prisma Client Extension
 * (`$extends`): extension `query` hooks do not preserve
 * AsyncLocalStorage context in this stack (confirmed empirically against
 * Prisma 7 + @prisma/adapter-pg — the hook always observed a lost/empty
 * store even in the simplest passthrough case), so `getCurrentTenantOrgId()`
 * would silently read `null` inside one. A plain Proxy that itself calls
 * `this.$transaction(...)` directly does preserve the context, because the
 * call originates from our own code rather than from inside Prisma's
 * extension dispatch. See git history of this file for the spike that
 * ruled out the extension-based approach.
 *
 * Multi-operation transactions that need cross-model atomicity (e.g.
 * OrganizationsRepository#createWithOwner) must call
 * `this.$transaction(...)` directly and set `app.current_org_id`
 * themselves at the top of the callback — the `tx` handle they receive is
 * a plain, unwrapped Prisma.TransactionClient, not routed through this
 * proxy layer.
 *
 * For legal/compliance audit data use PrismaLegalService (@libs/prisma-legal).
 */
@Injectable()
export class PrismaBusinessService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaBusinessService.name);
  private readonly config: ConfigService;

  constructor(config: ConfigService) {
    const connectionString =
      config.get<string>('database.url') ?? process.env['DATABASE_URL'] ?? '';
    const adapter = new PrismaPg({ connectionString });
    super({
      adapter,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
    this.config = config;
  }

  async onModuleInit() {
    this.logger.log('Connecting to business database...');
    try {
      await this['$connect']();
      this.wrapTenantScopedDelegates();
      this.logger.log('PrismaBusinessService connected successfully');
    } catch (error) {
      this.logger.error('Failed to connect to business database', error);
      throw error;
    }
  }

  /**
   * Replaces each TENANT_SCOPED_MODELS delegate property on this instance
   * with a Proxy that transparently opens an RLS-scoped transaction per
   * method call. See the class-level doc comment for why this is a Proxy
   * rather than a Prisma Client Extension.
   */
  private wrapTenantScopedDelegates(): void {
    for (const modelName of TENANT_SCOPED_MODELS) {
      const delegate = (this as Record<string, unknown>)[modelName];
      if (delegate === null || typeof delegate !== 'object') {
        // Defensive only: the real generated Prisma Client always exposes
        // every model delegate as an object, connected or not. This guards
        // against a future TENANT_SCOPED_MODELS entry racing ahead of a
        // schema/generated-client update, and against minimal test doubles
        // that don't stub every delegate.
        this.logger.warn(
          `wrapTenantScopedDelegates: no delegate found for model "${modelName}", skipping RLS wrapping for it`,
        );
        continue;
      }
      (this as Record<string, unknown>)[modelName] = new Proxy(delegate, {
        get: (target, prop, receiver) => {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const orgId = getCurrentTenantOrgId();
            const userId = getCurrentTenantUserId();
            const systemLookup = isSystemLookup();
            return this.$transaction(async (tx) => {
              await tx.$executeRaw`SELECT set_config('app.current_org_id', ${orgId}, true)`;
              await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
              await tx.$executeRaw`SELECT set_config('app.system_lookup', ${systemLookup ? 'true' : 'false'}, true)`;
              const txDelegate = (tx as unknown as Record<string, unknown>)[
                modelName
              ] as Record<string, (...a: unknown[]) => unknown>;
              return txDelegate[prop as string](...args);
            });
          };
        },
      });
    }
  }

  /**
   * Called automatically by NestJS when the process receives a shutdown signal
   * (SIGTERM, SIGINT, …) — requires app.enableShutdownHooks() in main.ts.
   */
  async onModuleDestroy() {
    this.logger.log('Disconnecting from business database...');
    await this['$disconnect']();
  }

  /**
   * Deletes all rows from every model — for use in tests only.
   * Throws if called in production to prevent accidental data loss.
   *
   * Order matters: child tables (those with FK references) must be deleted
   * before their parent tables to avoid foreign key constraint violations.
   */
  async cleanDatabase(): Promise<void> {
    if (this.config.get<string>('app.nodeEnv') === 'production') {
      throw new Error('Cannot clean database in production');
    }

    // Delete in dependency order: children before parents.
    await this.orgExport.deleteMany();
    await this.activityLog.deleteMany();
    await this.billingEvent.deleteMany();
    await this.job.deleteMany();
    await this.membership.deleteMany();
    await this.organization.deleteMany();
    await this.user.deleteMany();
  }
}
