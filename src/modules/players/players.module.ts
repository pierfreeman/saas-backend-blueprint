import { Module } from '@nestjs/common';
import { PlayersService } from './players.service';
import { PlayersController } from './players.controller';
import { MembershipsModule } from '../memberships/memberships.module';
import { FeatureFlagsModule } from '../feature-flags/feature-flags.module';
import { RBACModule } from '../rbac/rbac.module';

@Module({
  imports: [MembershipsModule, FeatureFlagsModule, RBACModule],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
