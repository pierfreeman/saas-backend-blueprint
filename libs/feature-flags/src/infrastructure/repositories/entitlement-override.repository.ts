import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaBusinessService } from '@libs/prisma-business';

export interface EntitlementOverrideRow {
  id: string;
  orgId: string;
  key: string;
  /** Raw JSON string value ("true", "25", etc.) */
  value: string;
  reason: string;
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertOverrideParams {
  key: string;
  /** Already-serialised JSON string. */
  value: string;
  reason: string;
  expiresAt: Date | null;
  createdBy: string;
}

@Injectable()
export class EntitlementOverrideRepository {
  constructor(private readonly prisma: PrismaBusinessService) {}

  /** Returns only non-expired overrides for an org (used at read time). */
  findActiveByOrg(orgId: string): Promise<EntitlementOverrideRow[]> {
    return this.prisma.entitlementOverride.findMany({
      where: {
        orgId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  /** Returns all overrides (including expired) ordered by creation date. */
  findAllByOrg(orgId: string): Promise<EntitlementOverrideRow[]> {
    return this.prisma.entitlementOverride.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
  }

  upsert(
    orgId: string,
    params: UpsertOverrideParams,
  ): Promise<EntitlementOverrideRow> {
    return this.prisma.entitlementOverride.upsert({
      where: { orgId_key: { orgId, key: params.key } },
      create: {
        orgId,
        key: params.key,
        value: params.value,
        reason: params.reason,
        expiresAt: params.expiresAt,
        createdBy: params.createdBy,
      },
      update: {
        value: params.value,
        reason: params.reason,
        expiresAt: params.expiresAt,
        createdBy: params.createdBy,
      },
    });
  }

  async delete(orgId: string, key: string): Promise<void> {
    const existing = await this.prisma.entitlementOverride.findUnique({
      where: { orgId_key: { orgId, key } },
    });
    if (!existing) {
      throw new NotFoundException(
        `No entitlement override found for key '${key}' on org '${orgId}'.`,
      );
    }
    await this.prisma.entitlementOverride.delete({
      where: { orgId_key: { orgId, key } },
    });
  }
}
