import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';

interface AuthenticatedSocket extends Socket {
  userId?: string;
}

/**
 * WsJwtGuard
 *
 * WebSocket guard that verifies the socket has an authenticated user context.
 * JWT verification and user resolution are performed in `handleConnection`
 * of the gateway; this guard simply checks that `userId` has been attached.
 *
 * This guard is intentionally lightweight — it never re-validates the token
 * on each message, trusting the connection-time verification instead.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<AuthenticatedSocket>();
    return !!client.userId;
  }
}
