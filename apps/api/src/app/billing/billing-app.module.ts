import { Module } from '@nestjs/common';
import { BillingModule } from '@libs/billing';
import { LegalAuditModule } from '@libs/legal-audit';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '../rbac/rbac.module';
import { BillingController } from './billing.controller';
import { WebhookController } from './webhook.controller';

/**
 * BillingAppModule
 * HTTP layer for billing features in the api application.
 *
 * Mounts BillingController and WebhookController, using the authentication
 * and RBAC guards already present in the api app. Delegates all business
 * logic to the services exported from the shared BillingModule.
 *
 * Mirrors the pattern used by ActivityLogAppModule:
 *   - libs/billing    → shared services, infra, webhook handlers (no controllers)
 *   - BillingAppModule → HTTP controllers wired to real guards
 */
@Module({
  imports: [BillingModule, LegalAuditModule, AuthModule, RBACModule],
  controllers: [BillingController, WebhookController],
})
export class BillingAppModule {}
