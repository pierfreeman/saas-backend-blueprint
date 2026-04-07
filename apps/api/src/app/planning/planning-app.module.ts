import { Module } from '@nestjs/common';
import { PlanningModule } from '@libs/planning';
import { RBACModule } from '@libs/rbac';
import { FeatureFlagsModule } from '@libs/feature-flags';
import { PlanningController } from './planning.controller';

@Module({
  imports: [PlanningModule, RBACModule, FeatureFlagsModule],
  controllers: [PlanningController],
})
export class PlanningAppModule {}
