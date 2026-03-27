/**
 * Injection token for an optional cache notifier that is called after
 * membership mutations (create / update / delete). The app module provides
 * the concrete implementation (RBACCacheService) using `useExisting`.
 */
export const MEMBERSHIP_CACHE_NOTIFIER = Symbol('MEMBERSHIP_CACHE_NOTIFIER');

export interface IMembershipCacheNotifier {
  invalidate(userId: string, orgId: string): Promise<void>;
}
