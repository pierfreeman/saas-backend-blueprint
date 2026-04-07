import {
  JobStatus,
  MembershipRole,
  OrganizationStatus,
} from '@libs/prisma-business';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

// ── Organizations ─────────────────────────────────────────────────────────────

export const PLAN_TIERS = ['FREE', 'PRO', 'ENTERPRISE'] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export class AdminProvisionOrgDto {
  @ApiProperty({
    description: 'Name of the new organization',
    example: 'Acme Corp',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Email address of the user to assign as OWNER',
    example: 'owner@acme.com',
  })
  @IsEmail()
  @IsNotEmpty()
  ownerEmail!: string;

  @ApiPropertyOptional({
    description: 'Plan tier to assign (defaults to FREE)',
    enum: PLAN_TIERS,
    example: 'PRO',
  })
  @IsOptional()
  @IsEnum(PLAN_TIERS)
  plan?: PlanTier;
}

export class AdminSetOrgStatusDto {
  @ApiProperty({
    enum: OrganizationStatus,
    description: 'New organization lifecycle status',
    example: OrganizationStatus.SUSPENDED,
  })
  @IsEnum(OrganizationStatus)
  status!: OrganizationStatus;

  @ApiPropertyOptional({
    description:
      'Optional reason for the status change (e.g. policy violation)',
    example: 'Unpaid invoices after 60-day grace period',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListOrganizationsQueryDto {
  @ApiPropertyOptional({ description: 'Search by name or exact org ID' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: OrganizationStatus,
    description: 'Filter by lifecycle status',
  })
  @IsOptional()
  @IsEnum(OrganizationStatus)
  status?: OrganizationStatus;

  @ApiPropertyOptional({
    description: 'Max results (1–100)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Skip N items for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

// ── Memberships ───────────────────────────────────────────────────────────────

export class AdminListMembersQueryDto {
  @ApiPropertyOptional({
    description: 'Max results (1–200)',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;

  @ApiPropertyOptional({
    description: 'Skip N items for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}

export class AdminChangeRoleDto {
  @ApiProperty({
    enum: MembershipRole,
    description: 'New role to assign',
    example: MembershipRole.ADMIN,
  })
  @IsEnum(MembershipRole)
  newRole!: MembershipRole;
}

export class AdminInviteMemberDto {
  @ApiProperty({
    description: 'Email of the user to invite',
    example: 'user@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    enum: MembershipRole,
    description: 'Role to assign',
    example: MembershipRole.MEMBER,
  })
  @IsEnum(MembershipRole)
  role!: MembershipRole;
}

// ── Billing ───────────────────────────────────────────────────────────────────

export class AdminGetPortalUrlDto {
  @ApiProperty({
    description: 'URL to redirect back to after the Stripe portal session ends',
    example: 'https://app.example.com/admin',
  })
  @IsUrl()
  @IsNotEmpty()
  returnUrl!: string;
}

// ── Activity log ──────────────────────────────────────────────────────────────

export class AdminActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Max results (1–500)',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Skip N items for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    description: 'Filter by action prefix (e.g. membership.)',
    example: 'membership.',
  })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 start date',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value as string) : undefined))
  fromDate?: Date;

  @ApiPropertyOptional({
    description: 'ISO 8601 end date',
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsOptional()
  @Transform(({ value }) => (value ? new Date(value as string) : undefined))
  toDate?: Date;
}

export class AdminAllActivityQueryDto extends AdminActivityQueryDto {
  @ApiPropertyOptional({
    description: 'Narrow to a specific org UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @IsOptional()
  @IsString()
  orgId?: string;
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export class AdminListJobsQueryDto {
  @ApiPropertyOptional({
    description: 'Max results (1–200)',
    example: 50,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Skip N items for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    enum: JobStatus,
    description: 'Filter by job status',
    example: JobStatus.FAILED,
  })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiPropertyOptional({
    description: 'Filter by job type (exact match)',
    example: 'ORG_EXPORT',
  })
  @IsOptional()
  @IsString()
  type?: string;
}

// ── Feature flag overrides ────────────────────────────────────────────────────

/** Valid PlanEntitlements keys that can be overridden. */
export const OVERRIDE_KEYS = [
  'advancedAnalytics',
  'customReports',
  'apiAccess',
  'ssoEnabled',
  'prioritySupport',
  'maxSeats',
  'storageLimitBytes',
] as const;

export class SetFeatureFlagOverrideDto {
  @ApiProperty({
    description:
      'Feature flag key to override. Must be a valid PlanEntitlements key.',
    example: 'ssoEnabled',
    enum: OVERRIDE_KEYS,
  })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({
    description:
      'Override value. Use boolean for feature flags, number for limits.',
    example: true,
  })
  @IsDefined()
  value!: boolean | number;

  @ApiProperty({
    description: 'Mandatory reason for this override (for audit trail).',
    example: 'Enterprise trial arrangement — Acme Corp',
  })
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiPropertyOptional({
    description:
      'Optional expiry (ISO 8601). If set, override is automatically ignored after this date.',
    example: '2026-06-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export class AdminListExportsQueryDto {
  @ApiPropertyOptional({
    description: 'Max results (1–100)',
    example: 10,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10;

  @ApiPropertyOptional({
    description: 'Skip N items for pagination',
    example: 0,
    default: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
