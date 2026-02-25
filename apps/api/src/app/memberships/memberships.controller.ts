import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { Membership } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MembershipsService } from './memberships.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

@ApiTags('Memberships')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:orgId/memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @ApiOperation({ summary: 'Add a member to an organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Member added successfully.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.createMembership(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all members of an organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of memberships.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  async findByOrg(@Param('orgId') orgId: string): Promise<Membership[]> {
    return this.membershipsService.findByOrg(orgId);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a member's role" })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Membership UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Membership updated.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Membership not found.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.updateMembership(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a member from an organization' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiParam({ name: 'id', description: 'Membership UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Member removed.' })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Membership not found.',
  })
  async delete(@Param('id') id: string): Promise<{ message: string }> {
    await this.membershipsService.deleteMembership(id);
    return { message: 'Membership deleted successfully' };
  }
}
