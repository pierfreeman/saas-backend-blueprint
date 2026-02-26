import type { PaginatedAuditResult } from '@libs/audit';
import { AuditService } from '@libs/audit';
import { PERMISSIONS } from '@libs/common';
import {
  Controller,
  Get,
  HttpStatus,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgScoped } from '../rbac/decorators/org-scoped.decorator';
import { RequirePermissions } from '../rbac/decorators/require-permissions.decorator';
import { OrgContextGuard } from '../rbac/guards/org-context.guard';
import { RBACGuard } from '../rbac/guards/rbac.guard';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@ApiBearerAuth()
@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@Controller('organizations/:orgId/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /organizations/:orgId/audit
   *
   * Returns ordered (newest-first) paginated audit events for the given
   * organisation.  Access is restricted to OWNER and ADMIN members only —
   * MEMBER and READ_ONLY roles receive 403.  The endpoint is intentionally
   * read-only; no POST/PATCH/DELETE routes are exposed (ISO 27001 A.8.15 –
   * immutable audit trail).
   */
  @Get()
  @RequirePermissions([PERMISSIONS.AUDIT_READ])
  @ApiOperation({
    summary: 'List audit events for an organisation',
    description:
      'Returns a paginated, newest-first list of audit events scoped to the ' +
      'given organisation.  Accessible only to members with OWNER or ADMIN ' +
      'role.  Records are read-only and cannot be modified or deleted through ' +
      'this API (ISO 27001 A.8.15 – immutable audit trail).',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organisation UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Paginated audit events returned successfully.',
    schema: {
      type: 'object',
      properties: {
        events: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              type: { type: 'string', example: 'org.created' },
              severity: {
                type: 'string',
                enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
              },
              orgId: { type: 'string', format: 'uuid', nullable: true },
              userId: { type: 'string', format: 'uuid', nullable: true },
              payload: { type: 'object' },
              ipAddress: { type: 'string', nullable: true },
              userAgent: { type: 'string', nullable: true },
              correlationId: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
        },
        total: { type: 'number', example: 42 },
        limit: { type: 'number', example: 50 },
        offset: { type: 'number', example: 0 },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller does not belong to this organisation or has insufficient role ' +
      '(requires OWNER or ADMIN).',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters (e.g. non-numeric limit/offset).',
  })
  async getAuditLog(
    @Param('orgId') orgId: string,
    @Query() query: AuditQueryDto,
  ): Promise<PaginatedAuditResult> {
    const { limit, offset, typePrefix, severity, fromDate, toDate } = query;
    const effectiveLimit = Math.min(limit ?? 100, 500);
    const effectiveOffset = offset ?? 0;

    return this.auditService.findByOrg(orgId, {
      limit: effectiveLimit,
      offset: effectiveOffset,
      typePrefix: typePrefix || undefined,
      severity,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate: toDate ? new Date(toDate) : undefined,
    });
  }
}
