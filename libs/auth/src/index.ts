export { AuthModule } from './auth.module';
export { AuthService } from './application/services/auth.service';
export { PENDING_AUTH0_ID_PREFIX } from './constants';
export { Auth0ManagementService } from './infrastructure/clients/auth0-management.service';
export type { Auth0User } from './infrastructure/clients/auth0-management.service';
export { JwtStrategy } from './jwt.strategy';
