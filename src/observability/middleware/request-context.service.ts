import { AsyncLocalStorage } from 'async_hooks';

/**
 * Request Context
 *
 * Holds correlation data for a single request lifecycle.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  orgId?: string;
  timestamp: Date;
}

/**
 * Request Context Service
 *
 * Uses AsyncLocalStorage to maintain request context across async operations.
 * This allows logging and error tracking to access request metadata anywhere
 * in the call stack without explicitly passing it around.
 */
export class RequestContextService {
  private static asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

  /**
   * Run a function with a specific request context
   */
  static run<T>(context: RequestContext, callback: () => T): T {
    return this.asyncLocalStorage.run(context, callback);
  }

  /**
   * Get the current request context (if any)
   */
  static getContext(): RequestContext | undefined {
    return this.asyncLocalStorage.getStore();
  }

  /**
   * Get the current request ID
   */
  static getRequestId(): string | undefined {
    return this.getContext()?.requestId;
  }

  /**
   * Get the current user ID
   */
  static getUserId(): string | undefined {
    return this.getContext()?.userId;
  }

  /**
   * Get the current organization ID
   */
  static getOrgId(): string | undefined {
    return this.getContext()?.orgId;
  }

  /**
   * Update the current context (merge with existing)
   */
  static updateContext(updates: Partial<Omit<RequestContext, 'timestamp'>>): void {
    const current = this.getContext();
    if (!current) {
      return;
    }

    if (updates.requestId) current.requestId = updates.requestId;
    if (updates.userId) current.userId = updates.userId;
    if (updates.orgId) current.orgId = updates.orgId;
  }
}
