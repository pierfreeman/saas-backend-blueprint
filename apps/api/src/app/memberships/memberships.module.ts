import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantModule } from '@libs/common';
import {
  MembershipsModule as MembershipsLibModule,
  SEAT_LIMIT_PROVIDER,
} from '@libs/memberships';
import { OrganizationsModule } from '@libs/organizations';
import { UsersModule } from '@libs/users';
import { MembershipsController } from './memberships.controller';
import { RBACModule } from '@libs/rbac';
import { InviteMemberService } from './invite-member.service';
import { RemoveMemberService } from './remove-member.service';
import { AuthModule } from '../auth/auth.module';
import { FeatureFlagsModule, FeatureFlagsService } from '@libs/feature-flags';

@Module({
  imports: [
    MembershipsLibModule,
    RBACModule,
    TenantModule,
    UsersModule,
    OrganizationsModule,
    ConfigModule,
    AuthModule,
    FeatureFlagsModule,
  ],
  controllers: [MembershipsController],
  providers: [
    InviteMemberService,
    RemoveMemberService,
    { provide: SEAT_LIMIT_PROVIDER, useExisting: FeatureFlagsService },
  ],
})
export class MembershipsModule {}
