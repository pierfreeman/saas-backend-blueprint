import { Module } from '@nestjs/common';
import { RBACModule } from '@libs/rbac';
import {
  MembershipsModule as MembershipsLibModule,
  SEAT_LIMIT_PROVIDER,
} from '@libs/memberships';
import { MembershipsController } from './memberships.controller';
import { FeatureFlagsModule, FeatureFlagsService } from '@libs/feature-flags';

@Module({
  imports: [
    MembershipsLibModule,
    RBACModule,
    FeatureFlagsModule,
  ],
  controllers: [MembershipsController],
  providers: [
    { provide: SEAT_LIMIT_PROVIDER, useExisting: FeatureFlagsService },
  ],
})
export class MembershipsModule {}
