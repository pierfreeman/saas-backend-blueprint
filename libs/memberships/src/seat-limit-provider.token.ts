/**
 * Injection token for an optional seat-limit provider that is called before
 * membership mutations (create) to enforce plan-based seat limits.
 * The app module provides the concrete implementation (FeatureFlagsService)
 * using `useExisting`. When the token is not provided the seat check is skipped.
 */
export const SEAT_LIMIT_PROVIDER = Symbol('SEAT_LIMIT_PROVIDER');

export interface ISeatLimitProvider {
  getMaxSeats(orgId: string): Promise<number>;
}
