import { Module } from '@nestjs/common';
import { PlanningModule } from '@libs/planning';
import { RBACModule } from '@libs/rbac';
import { PlanningController } from './planning.controller';

@Module({
  imports: [PlanningModule, RBACModule],
  controllers: [PlanningController],
})
export class PlanningAppModule {}
