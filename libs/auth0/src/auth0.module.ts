import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '@libs/users';
import { EmailModule } from '@libs/email';
import { ActivityLogModule } from '@libs/activity-log';
import { LegalAuditModule } from '@libs/legal-audit';
import { MembershipsModule } from '@libs/memberships';
import { Auth0ManagementClient } from './infrastructure/clients/auth0-management.client';
import { Auth0IdentityProvider } from './infrastructure/providers/auth0-identity.provider';
import { IIdentityProvider } from './domain/ports/identity-provider.interface';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './application/services/auth.service';

@Global()
@Module({
  imports: [
    UsersModule,
    ConfigModule,
    EmailModule,
    ActivityLogModule,
    LegalAuditModule,
    MembershipsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}),
  ],
  providers: [
    Auth0ManagementClient,
    { provide: IIdentityProvider, useClass: Auth0IdentityProvider },
    JwtStrategy,
    AuthService,
  ],
  exports: [AuthService, IIdentityProvider, PassportModule],
})
export class Auth0Module {}
