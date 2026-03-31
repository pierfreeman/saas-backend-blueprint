import { Module } from '@nestjs/common';
import { AuthModule as AuthLibModule } from '@libs/auth';
import { AuthController } from './auth.controller';

@Module({
  imports: [AuthLibModule],
  controllers: [AuthController],
  exports: [AuthLibModule],
})
export class AuthModule {}
