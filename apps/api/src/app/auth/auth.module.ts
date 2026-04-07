import { Module } from '@nestjs/common';
import { Auth0Module } from '@libs/auth0';
import { AuthController } from './auth.controller';

@Module({
  imports: [Auth0Module],
  controllers: [AuthController],
  exports: [Auth0Module],
})
export class AuthModule {}
