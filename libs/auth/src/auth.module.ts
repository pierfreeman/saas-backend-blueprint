import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@libs/users';
import { EmailModule } from '@libs/email';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './application/services/auth.service';
import { Auth0ManagementService } from './infrastructure/clients/auth0-management.service';

@Module({
  imports: [
    UsersModule,
    ConfigModule,
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  providers: [JwtStrategy, AuthService, Auth0ManagementService],
  exports: [AuthService, Auth0ManagementService, PassportModule],
})
export class AuthModule {}
