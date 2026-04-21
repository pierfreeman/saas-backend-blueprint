import { Module } from '@nestjs/common';
import { AiModule } from '@libs/ai';
import { AuthModule } from '../auth/auth.module';
import { RBACModule } from '@libs/rbac';
import { AiController } from './ai.controller';

@Module({
  imports: [AiModule, AuthModule, RBACModule],
  controllers: [AiController],
})
export class AiAppModule {}
