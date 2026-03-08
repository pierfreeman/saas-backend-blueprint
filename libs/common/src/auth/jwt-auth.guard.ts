import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';

/**
 * JwtAuthGuard
 *
 * HTTP guard that delegates to the Passport JWT strategy (`'jwt'`).
 * The strategy (registered at app level) validates the RS256 signature via
 * JWKS and attaches the resolved user to `request.user`.
 *
 * Exported from `@libs/common` so it can be shared across libraries without
 * creating a dependency on an application-level module.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return super.canActivate(context);
  }

  override handleRequest<TUser = unknown>(
    err: Error | null,
    user: TUser,
  ): TUser {
    if (err || !user) {
      throw err ?? new UnauthorizedException('Authentication required');
    }
    return user;
  }
}
