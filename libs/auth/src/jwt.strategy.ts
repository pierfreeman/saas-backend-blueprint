import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthService } from './application/services/auth.service';

interface JwtPayload {
  sub: string;
  /** Standard OIDC email claim — present in the ID token but NOT in the
   *  Auth0 access token by default. Only available here when an Auth0
   *  Post-Login Action copies it into the access token (non-namespaced). */
  email?: string;
  iss: string;
  aud: string | string[];
  /** Auth0 custom claims must be namespaced. The Post-Login Action sets
   *  `{namespace}/email` so we can identify the caller's real email address. */
  [claim: string]: unknown;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    const domain = configService.get<string>('auth.domain');
    const audience = configService.get<string>('auth.audience');
    const issuer = configService.get<string>('auth.issuer');
    const jwksUri = configService.get<string>('auth.jwksUri');

    if (!domain || !audience || !issuer || !jwksUri) {
      throw new Error('Auth0 configuration is incomplete');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience,
      issuer,
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri,
      }),
    });
  }

  async validate(payload: JwtPayload): Promise<{ sub: string; email: string }> {
    if (!payload.sub) {
      this.logger.error('JWT payload missing sub claim');
      throw new UnauthorizedException('Invalid token');
    }

    // Auth0 access tokens don't include `email` by default — the Post-Login
    // Action injects it as a namespaced custom claim. Fall back to the plain
    // `email` claim (ID-token passthrough setups) and finally to a synthetic
    // placeholder so syncUser can still run (it will create a new account).
    const namespace = this.configService.get<string>('auth.claimsNamespace');
    const namespacedEmail = namespace
      ? (payload[`${namespace}/email`] as string | undefined)
      : undefined;
    const email =
      namespacedEmail ?? payload.email ?? `${payload.sub}@auth0.placeholder`;

    this.logger.debug(`JWT validated for user: ${payload.sub}`);

    try {
      const user = await this.authService.syncUser(payload.sub, email);
      return {
        sub: payload.sub,
        email: user.email,
      };
    } catch (error) {
      this.logger.error(
        `Failed to sync user ${payload.sub}`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
      throw new UnauthorizedException('Failed to authenticate user');
    }
  }
}
