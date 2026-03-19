import { JwtAuthGuard, PERMISSIONS } from '@libs/common';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Membership } from '@prisma/client';
import { OrgScoped, RequirePermissions, OrgContextGuard, RBACGuard } from '@libs/rbac';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';
import { MembershipsService } from '@libs/memberships';

@ApiTags('Memberships')
@ApiBearerAuth()
@OrgScoped()
@UseGuards(JwtAuthGuard, OrgContextGuard, RBACGuard)
@Controller('organizations/:orgId/memberships')
export class MembershipsController {
  constructor(private readonly membershipsService: MembershipsService) {}

  @Post()
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_INVITE])
  @ApiOperation({
    summary: 'Add a member to an organization',
    description:
      'Invites an existing user into the organization with the specified role. ' +
      'Requires ORG_MEMBERS_INVITE permission (OWNER or ADMIN).',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Membership record created.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'd4e5f6a7-b8c9-4012-a345-678901bcdef2',
        },
        userId: {
          type: 'string',
          format: 'uuid',
          example: 'c7b3e1a2-45d6-4f89-9012-3456789abcde',
        },
        orgId: {
          type: 'string',
          format: 'uuid',
          example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
        },
        role: {
          type: 'string',
          enum: ['OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY'],
          example: 'MEMBER',
        },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'INVITED', 'SUSPENDED'],
          example: 'ACTIVE',
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
      },
      required: [
        'id',
        'userId',
        'orgId',
        'role',
        'status',
        'createdAt',
        'updatedAt',
      ],
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Validation failed — userId must be a string; role must be a valid MembershipRole.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description:
      'Caller lacks ORG_MEMBERS_INVITE permission, or the organization has reached its seat limit.',
  })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.createMembership(orgId, dto);
  }

  @Get()
  @RequirePermissions([PERMISSIONS.ORG_READ])
  @ApiOperation({
    summary: 'List all members of an organization',
    description:
      'Returns all membership records for the given organization, including each ' +
      "member's role and status. Requires ORG_READ permission.",
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Array of membership records.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            format: 'uuid',
            example: 'd4e5f6a7-b8c9-4012-a345-678901bcdef2',
          },
          userId: {
            type: 'string',
            format: 'uuid',
            example: 'c7b3e1a2-45d6-4f89-9012-3456789abcde',
          },
          orgId: {
            type: 'string',
            format: 'uuid',
            example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
          },
          role: {
            type: 'string',
            enum: ['OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY'],
            example: 'ADMIN',
          },
          status: {
            type: 'string',
            enum: ['ACTIVE', 'INVITED', 'SUSPENDED'],
            example: 'ACTIVE',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-02-26T12:34:56.789Z',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2026-02-26T12:34:56.789Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller lacks ORG_READ permission.',
  })
  async findByOrg(@Param('orgId') orgId: string): Promise<Membership[]> {
    return this.membershipsService.findByOrg(orgId);
  }

  @Patch(':id')
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_ROLE_UPDATE])
  @ApiOperation({
    summary: "Update a member's role",
    description:
      'Changes the role of an existing membership. ' +
      'Requires ORG_MEMBERS_ROLE_UPDATE permission (OWNER or ADMIN). ' +
      'An OWNER cannot demote themselves.',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiParam({
    name: 'id',
    description: 'Membership UUID',
    example: 'd4e5f6a7-b8c9-4012-a345-678901bcdef2',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Updated membership record.',
    schema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          format: 'uuid',
          example: 'd4e5f6a7-b8c9-4012-a345-678901bcdef2',
        },
        userId: {
          type: 'string',
          format: 'uuid',
          example: 'c7b3e1a2-45d6-4f89-9012-3456789abcde',
        },
        orgId: {
          type: 'string',
          format: 'uuid',
          example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
        },
        role: {
          type: 'string',
          enum: ['OWNER', 'ADMIN', 'MEMBER', 'READ_ONLY'],
          example: 'ADMIN',
        },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'INVITED', 'SUSPENDED'],
          example: 'ACTIVE',
        },
        createdAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T12:34:56.789Z',
        },
        updatedAt: {
          type: 'string',
          format: 'date-time',
          example: '2026-02-26T13:00:00.000Z',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Validation failed — role must be a valid MembershipRole enum value.',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller lacks ORG_MEMBERS_ROLE_UPDATE permission.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Membership not found.',
  })
  async update(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMembershipDto,
  ): Promise<Membership> {
    return this.membershipsService.updateMembership(id, orgId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions([PERMISSIONS.ORG_MEMBERS_REMOVE])
  @ApiOperation({
    summary: 'Remove a member from an organization',
    description:
      "Permanently removes a membership record, revoking the user's access to " +
      'the organization. Requires ORG_MEMBERS_REMOVE permission (OWNER or ADMIN). ' +
      'Owners cannot remove themselves.',
  })
  @ApiParam({
    name: 'orgId',
    description: 'Organization UUID',
    example: 'a1b2c3d4-e5f6-4789-ab01-cd2345ef6789',
  })
  @ApiParam({
    name: 'id',
    description: 'Membership UUID',
    example: 'd4e5f6a7-b8c9-4012-a345-678901bcdef2',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Member removed successfully.',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Membership deleted successfully' },
      },
      required: ['message'],
    },
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Missing or invalid JWT bearer token.',
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Caller lacks ORG_MEMBERS_REMOVE permission.',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Membership not found.',
  })
  async delete(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    await this.membershipsService.deleteMembership(id, orgId);
    return { message: 'Membership deleted successfully' };
  }
}
