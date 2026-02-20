import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditEvent } from '@prisma/client';
import { EventBusService, DomainEvent } from '../../events/event-bus.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  private readonly uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
  ) {}

  async logEvent(
    type: string,
    orgId: string | null,
    userId: string | null,
    payload: Record<string, unknown>,
  ): Promise<AuditEvent> {
    this.logger.debug(
      `Logging audit event: ${type} for org ${orgId || 'N/A'}, user ${userId || 'N/A'}`,
    );

    const auditEvent = await this.prisma.auditEvent.create({
      data: {
        type,
        orgId,
        userId,
        payload: payload as never,
      },
    });

    // Emit to event bus for other listeners
    this.eventBus.emit({
      eventType: 'audit.logged',
      timestamp: new Date(),
      organizationId: orgId || undefined,
      userId: userId || undefined,
      payload: {
        auditEventId: auditEvent.id,
        type,
      },
    });

    return auditEvent;
  }

  async findByOrg(orgId: string, limit = 100, offset = 0): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findByType(type: string, limit = 100, offset = 0): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      where: { type },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findAll(limit = 100, offset = 0): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async countByOrg(orgId: string): Promise<number> {
    return this.prisma.auditEvent.count({
      where: { orgId },
    });
  }

  // Event listeners for automatic audit logging
  @OnEvent('user.created')
  async handleUserCreated(event: DomainEvent): Promise<void> {
    await this.logEvent('user.created', null, event.userId || null, event.payload);
  }

  @OnEvent('organization.created')
  async handleOrganizationCreated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'organization.created',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('team.created')
  async handleTeamCreated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'team.created',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('player.created')
  async handlePlayerCreated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'player.created',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('subscription.updated')
  async handleSubscriptionUpdated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'subscription.updated',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('membership.created')
  async handleMembershipCreated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'membership.created',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('membership.updated')
  async handleMembershipUpdated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'membership.updated',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('membership.deleted')
  async handleMembershipDeleted(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'membership.deleted',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('organization.updated')
  async handleOrganizationUpdated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'organization.updated',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('organization.deleted')
  async handleOrganizationDeleted(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'organization.deleted',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('team.updated')
  async handleTeamUpdated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'team.updated',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('team.deleted')
  async handleTeamDeleted(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'team.deleted',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('player.updated')
  async handlePlayerUpdated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'player.updated',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('player.deleted')
  async handlePlayerDeleted(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'player.deleted',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('billing.checkout.created')
  async handleBillingCheckoutCreated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'billing.checkout.created',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('billing.portal.created')
  async handleBillingPortalCreated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'billing.portal.created',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('billing.subscription.cancelled')
  async handleBillingSubscriptionCancelled(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'billing.subscription.cancelled',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('billing.subscription.reactivated')
  async handleBillingSubscriptionReactivated(event: DomainEvent): Promise<void> {
    await this.logEvent(
      'billing.subscription.reactivated',
      event.organizationId || null,
      event.userId || null,
      event.payload,
    );
  }

  @OnEvent('security.blocked')
  async handleSecurityBlocked(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    await this.logEvent(
      'security.blocked',
      this.asNullableUuid(event.organizationId) || this.asNullableUuid(payload.orgId),
      this.asNullableUuid(event.userId) || this.asNullableUuid(payload.userId),
      payload,
    );
  }

  @OnEvent('security.suspicious')
  async handleSecuritySuspicious(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    await this.logEvent(
      'security.suspicious',
      this.asNullableUuid(event.organizationId) || this.asNullableUuid(payload.orgId),
      this.asNullableUuid(event.userId) || this.asNullableUuid(payload.userId),
      payload,
    );
  }

  private asNullableUuid(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    return this.uuidRegex.test(value) ? value : null;
  }
}
