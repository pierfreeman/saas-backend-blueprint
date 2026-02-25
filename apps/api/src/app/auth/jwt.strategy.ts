import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthService } from './auth.service';

interface JwtPayload {
  sub: string;
  email?: string;
  iss: string;
  aud: string | string[];
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

    const email = payload.email ?? `${payload.sub}@auth0.placeholder`;

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
