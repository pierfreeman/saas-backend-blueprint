import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { JwksClient } from 'jwks-rsa';
import * as jwt from 'jsonwebtoken';

/**
 * WsJwtGuard
 *
 * WebSocket-level JWT authentication guard for socket.io gateways.
 *
 * Validates the Auth0 RS256 JWT presented by the client at handshake time.
 * The token can be passed via:
 *   1. `socket.handshake.auth.token` (preferred)
 *   2. `socket.handshake.headers.authorization` (Bearer scheme)
 *
 * On success: attaches the decoded payload to `socket.data.user`.
 * On failure: throws WsException('Unauthorized') which disconnects the client.
 *
 * Apply to gateways:
 * ```typescript
 * @UseGuards(WsJwtGuard)
 * @WebSocketGateway()
 * export class NotificationsGateway { ... }
 * ```
 *
 * For per-message auth checks, combine with a dedicated message-level guard.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);
  private readonly jwksClient: JwksClient;
  private readonly audience: string;
  private readonly issuer: string;

  constructor(private readonly configService: ConfigService) {
    const jwksUri = configService.get<string>('auth.jwksUri');
    this.audience = configService.get<string>('auth.audience') ?? '';
    this.issuer = configService.get<string>('auth.issuer') ?? '';

    if (!jwksUri) {
      throw new Error('WsJwtGuard: auth.jwksUri configuration is missing');
    }

    this.jwksClient = new JwksClient({
      jwksUri,
      cache: true,
      cacheMaxAge: 600_000, // 10 minutes
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn('WS connection rejected: no token provided');
      throw new WsException('Unauthorized: no token provided');
    }

    try {
      const payload = await this.verifyToken(token);
      // Attach the validated payload to socket.data for downstream use
      client.data['user'] = payload;
      return true;
    } catch (err) {
      this.logger.warn(
        `WS connection rejected: token validation failed — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw new WsException('Unauthorized: invalid token');
    }
  }

  private extractToken(client: Socket): string | null {
    // Prefer auth object (socket.io v3+)
    const authToken = client.handshake?.auth?.['token'];
    if (authToken && typeof authToken === 'string') return authToken;

    // Fall back to Authorization header
    const authHeader = client.handshake?.headers?.['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        return parts[1];
      }
    }

    return null;
  }

  private async verifyToken(token: string): Promise<jwt.JwtPayload> {
    return new Promise((resolve, reject) => {
      // Decode header to get the key ID (kid)
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        return reject(new Error('Invalid token structure'));
      }

      const kid = decoded.header.kid;

      this.jwksClient.getSigningKey(kid, (err, key) => {
        if (err || !key) {
          return reject(err ?? new Error('Unable to fetch signing key'));
        }

        const signingKey = key.getPublicKey();

        jwt.verify(
          token,
          signingKey,
          {
            algorithms: ['RS256'],
            audience: this.audience,
            issuer: this.issuer,
          },
          (verifyErr, payload) => {
            if (verifyErr) return reject(verifyErr);
            resolve(payload as jwt.JwtPayload);
          },
        );
      });
    });
  }
}
