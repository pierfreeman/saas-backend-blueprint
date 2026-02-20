import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [MembershipsModule, FeatureFlagsModule, RBACModule],
  controllers: [TeamsController],
  providers: [TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
