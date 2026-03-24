import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantModule } from '@libs/common';
import { MembershipsModule as MembershipsLibModule } from '@libs/memberships';
import { OrganizationsModule } from '@libs/organizations';
import { UsersModule } from '@libs/users';
import { MembershipsController } from './memberships.controller';
import { RBACModule } from '@libs/rbac';
import { InviteMemberService } from './invite-member.service';
import { RemoveMemberService } from './remove-member.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MembershipsLibModule,
    RBACModule,
    TenantModule,
    UsersModule,
    OrganizationsModule,
    ConfigModule,
    AuthModule,
  ],
  controllers: [MembershipsController],
  providers: [InviteMemberService, RemoveMemberService],
})
export class MembershipsModule {}
