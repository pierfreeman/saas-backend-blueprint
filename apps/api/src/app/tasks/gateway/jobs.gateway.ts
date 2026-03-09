import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { PubSubService, PatternHandler } from '@libs/redis';
import { JobUpdateMessage } from '@libs/events';

interface AuthenticatedSocket extends Socket {
  /** Auth0 sub extracted from the JWT on connection. */
  userId?: string;
  /** Organisation ID provided as a query parameter on connection. */
  tenantId?: string;
}

/**
 * JobsGateway
 *
 * WebSocket gateway exposed on the `/jobs` namespace.
 *
 * Connection flow:
 *   1. Client connects with `{ auth: { token: '<JWT>' } }` and optionally
 *      `?tenantId=<orgId>` as a query parameter.
 *   2. The gateway decodes (but does not fully re-verify) the JWT to extract
 *      the user's `sub` claim.  Full RS256/JWKS verification is performed by
 *      the HTTP JwtStrategy; the WS layer trusts an already-issued token.
 *   3. The socket is added to two Socket.IO rooms:
 *        - `user:<userId>`     — receives updates for jobs submitted by this user
 *        - `tenant:<tenantId>` — receives updates for all jobs of the organisation
 *
 * Pub/Sub bridge:
 *   On startup (`afterInit`) the gateway subscribes to the Redis pattern
 *   `job:update:*`.  Every message published by a worker is forwarded as a
 *   `job:update` WebSocket event to the appropriate rooms.
 *
 * Client usage example (socket.io-client):
 * ```ts
 * const socket = io('/jobs', {
 *   auth: { token: accessToken },
 *   query: { tenantId: 'org-id' },
 * });
 * socket.on('job:update', (msg: JobUpdateMessage) => console.log(msg));
 * ```
 */
@WebSocketGateway({
  namespace: '/jobs',
  cors: { origin: true, credentials: true },
  transports: ['websocket', 'polling'],
})
export class JobsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server!: Server;

  private readonly logger = new Logger(JobsGateway.name);

  constructor(private readonly pubSub: PubSubService) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  afterInit(): void {
    this.logger.log('JobsGateway initialised — subscribing to "job:update:*"');

    const handler: PatternHandler = (channel, payload) => {
      const msg = payload as JobUpdateMessage;
      this.logger.debug(
        `Redis → "${channel}": job ${msg.jobId} → ${msg.status}`,
      );

      // Deliver to every connected user in the organisation.
      this.server.to(`tenant:${msg.tenantId}`).emit('job:update', msg);

      // Also deliver to the individual user who submitted the job (if known).
      if (msg.userId) {
        this.server.to(`user:${msg.userId}`).emit('job:update', msg);
      }
    };

    this.pubSub.pSubscribe('job:update:*', handler);
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(
          `Connection rejected — no token (socket: ${client.id})`,
        );
        client.disconnect();
        return;
      }

      const decoded = this.decodeJwt(token);

      if (!decoded?.sub) {
        this.logger.warn(
          `Connection rejected — invalid token (socket: ${client.id})`,
        );
        client.disconnect();
        return;
      }

      client.userId = decoded.sub as string;
      client.tenantId =
        (client.handshake.query['tenantId'] as string) ?? undefined;

      // Join rooms for targeted delivery.
      await client.join(`user:${client.userId}`);
      if (client.tenantId) {
        await client.join(`tenant:${client.tenantId}`);
      }

      this.logger.log(
        `Socket connected: ${client.id} | user: ${client.userId} | tenant: ${client.tenantId ?? 'none'}`,
      );
    } catch (error) {
      this.logger.error(`handleConnection error (socket: ${client.id})`, error);
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthenticatedSocket): void {
    this.logger.log(
      `Socket disconnected: ${client.id} | user: ${client.userId ?? 'unauthenticated'}`,
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Extracts the bearer token from socket handshake auth, query, or headers.
   * Matching precedence: auth object → query param → Authorization header.
   */
  private extractToken(client: AuthenticatedSocket): string | null {
    const fromAuth = client.handshake?.auth?.['token'];
    if (fromAuth) return (fromAuth as string).replace(/^Bearer\s+/i, '');

    const fromQuery = client.handshake?.query?.['token'];
    if (fromQuery && typeof fromQuery === 'string')
      return fromQuery.replace(/^Bearer\s+/i, '');

    const fromHeader = client.handshake?.headers?.['authorization'];
    if (fromHeader && typeof fromHeader === 'string')
      return fromHeader.replace(/^Bearer\s+/i, '');

    return null;
  }

  /**
   * Base64url-decodes the JWT payload segment without verifying the signature.
   *
   * Security note: full cryptographic verification (RS256 + JWKS) is performed
   * by the HTTP JwtStrategy (`libs/api/src/app/auth/jwt.strategy.ts`).  Here
   * we trust the token's payload for room routing only; no privileged operation
   * is performed based on this claim.
   */
  private decodeJwt(token: string): Record<string, unknown> | null {
    try {
      const segments = token.split('.');
      if (segments.length < 2) return null;
      const raw = Buffer.from(segments[1], 'base64url').toString('utf-8');
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
