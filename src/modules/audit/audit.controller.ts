import { Controller, Get, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgScopeGuard } from '../../common/guards/org-scope.guard';
import { OrgId } from '../../common/decorators/org-id.decorator';
import { AuditService } from './audit.service';
import { AuditEvent } from '@prisma/client';

@ApiTags('Audit')
@ApiBearerAuth('JWT-auth')
@Controller('organizations/:orgId/audit')
@UseGuards(JwtAuthGuard, OrgScopeGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async getAuditLog(
    @OrgId() orgId: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
    @Query('offset', new ParseIntPipe({ optional: true })) offset?: number,
  ): Promise<{
    events: AuditEvent[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const effectiveLimit = limit || 100;
    const effectiveOffset = offset || 0;

    const [events, total] = await Promise.all([
      this.auditService.findByOrg(orgId, effectiveLimit, effectiveOffset),
      this.auditService.countByOrg(orgId),
    ]);

    return {
      events,
      total,
      limit: effectiveLimit,
      offset: effectiveOffset,
    };
  }
}
