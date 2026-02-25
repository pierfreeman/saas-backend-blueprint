import {
  Injectable,
  Inject,
  Scope,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';
import { TenantContext, TenantRequest } from '../types/tenant-context';

/**
 * TenantContextService
 *
 * REQUEST-scoped service: a new instance is created per HTTP request.
 * Inject this into any service that needs the current tenant context
 * instead of pulling raw headers from the request.
 *
 * Usage:
 *   constructor(private readonly tenantCtx: TenantContextService) {}
 *   const { tenantId } = this.tenantCtx.getContext();
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  constructor(
    @Inject(REQUEST) private readonly request: Request & TenantRequest,
  ) {}

  /**
   * Returns the full TenantContext for the current request.
   * Throws if the middleware has not yet populated the context.
   */
  getContext(): TenantContext {
    const ctx = this.request.tenantContext;
    if (!ctx) {
      throw new UnauthorizedException('Tenant context not available');
    }
    return ctx;
  }

  /** Convenience getter */
  get tenantId(): string {
    return this.getContext().tenantId;
  }

  /** Resolved DB userId (available after OrgContextGuard) */
  get userId(): string | undefined {
    return this.request.tenantContext?.userId;
  }

  /** Current role (available after RBACGuard) */
  get role(): string | undefined {
    return this.request.tenantContext?.role;
  }

  /** Current permissions (available after RBACGuard) */
  get permissions(): string[] {
    return this.request.tenantContext?.permissions ?? [];
  }

  /**
   * Enriches the tenant context in-place.
   * Called by OrgContextGuard / RBACGuard once they have resolved the user.
   */
  enrich(
    partial: Partial<Omit<TenantContext, 'tenantId' | 'timestamp'>>,
  ): void {
    if (!this.request.tenantContext) return;
    Object.assign(this.request.tenantContext, partial);
  }
}
