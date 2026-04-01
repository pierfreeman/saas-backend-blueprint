import { MembershipRole, OrganizationStatus } from '@libs/prisma-business';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

// ── Organizations ─────────────────────────────────────────────────────────────

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
