import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AdminIdentityService } from '../../application/services/admin-identity.service';
import type { AdminAuthConfig } from '@libs/config';

/**
 * JWT payload shape after Auth0 validation.
 * The `email` and `name` claims come from the configured claims namespace.
 */
interface AdminJwtPayload {
  sub: string;
  /** Standard OIDC email claim — may not be present in access tokens */
  email?: string;
  name?: string;
  /** Auth0 audience — may be string or string[] */
  aud?: string | string[];
  iss?: string;
  /** Index signature to allow namespace-prefixed custom claim lookup */
  [key: string]: unknown;
}

/**
 * AdminJwtStrategy
 *
 * Passport strategy name: 'admin-jwt'
 *
 * Validates RS256 JWTs issued by the admin-dedicated Auth0 application
 * ("SaaS Admin Portal") using the shared JWKS endpoint of the same tenant.
 *
 * On successful validation:
 * 1. Upserts the AdminUser record in the legal DB (via AdminIdentityService).
 * 2. Attaches { sub, email, adminUserId } to request.user.
 *
 * The strategy name 'admin-jwt' deliberately differs from the tenant
 * strategy name 'jwt' to avoid guard interference.
 */
@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  private readonly logger = new Logger(AdminJwtStrategy.name);
  private readonly claimsNamespace: string;

  constructor(
    configService: ConfigService,
    private readonly adminIdentityService: AdminIdentityService,
  ) {
    const adminAuth = configService.get<AdminAuthConfig>('adminAuth');

    if (!adminAuth?.domain || !adminAuth?.audience) {
      throw new Error(
        'AdminJwtStrategy: ADMIN_AUTH0_DOMAIN and ADMIN_AUTH0_AUDIENCE are required',
      );
    }

    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: adminAuth.jwksUri,
      }),
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: adminAuth.audience,
      issuer: adminAuth.issuer,
      algorithms: ['RS256'],
    });

    this.claimsNamespace = adminAuth.claimsNamespace ?? '';
  }

  async validate(payload: AdminJwtPayload): Promise<{
    sub: string;
    email: string;
    adminUserId: string;
  }> {
    this.logger.debug(`AdminJwtStrategy.validate: sub=${payload.sub}`);
    this.logger.debug(
      `AdminJwtStrategy.validate: payload keys=${Object.keys(payload).join(', ')}`,
    );
    this.logger.debug(
      `AdminJwtStrategy.validate: claimsNamespace=${this.claimsNamespace}`,
    );

    // Auth0 access tokens don't include `email` by default — the Post-Login
    // Action injects it as a namespaced custom claim. Fall back to the plain
    // `email` claim (ID-token passthrough) and finally to a synthetic value.
    const namespace = this.claimsNamespace;
    const namespacedEmail = namespace
      ? (payload[`${namespace}email`] as string | undefined)
      : undefined;
    const email =
      namespacedEmail ??
      (payload.email as string | undefined) ??
      `${payload.sub}@admin.placeholder`;

    // Same pattern for display name
    const namespacedName = namespace
      ? (payload[`${namespace}name`] as string | undefined)
      : undefined;
    const displayName = namespacedName ?? (payload.name as string | undefined);

    const profile = await this.adminIdentityService.syncAdminUser(
      payload.sub,
      email,
      displayName,
    );

    return {
      sub: payload.sub,
      email,
      adminUserId: profile.adminUserId,
    };
  }
}
