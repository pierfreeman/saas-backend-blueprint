import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@libs/users';
import { EmailModule } from '@libs/email';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { Auth0ManagementService } from './auth0-management.service';

@Module({
  imports: [
    UsersModule,
    ConfigModule,
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService, Auth0ManagementService],
  exports: [AuthService, PassportModule, Auth0ManagementService],
})
export class AuthModule {}
