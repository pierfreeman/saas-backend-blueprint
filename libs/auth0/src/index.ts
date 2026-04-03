export { Auth0Module } from './auth0.module';
export { AuthService } from './application/services/auth.service';
export { IIdentityProvider } from './domain/ports/identity-provider.interface';
export type { IdentityUser } from './domain/ports/identity-provider.interface';
export { Auth0IdentityProvider } from './infrastructure/providers/auth0-identity.provider';
export { JwtStrategy } from './jwt.strategy';
export { PENDING_USER_PREFIX } from './constants';
