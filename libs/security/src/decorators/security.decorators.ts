import { SetMetadata } from '@nestjs/common';

/** Metadata key used by RateLimitInterceptor to skip rate limiting */
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

/**
 * @SkipRateLimit()
 * Apply to a controller or handler to bypass the global rate-limit interceptor.
 * Useful for health-check endpoints or internal service callbacks.
 */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

/** Metadata key used by CsrfInterceptor to skip CSRF validation */
export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * @SkipCsrf()
 * Apply to endpoints that must bypass CSRF validation.
 * Required for:
 *  - Auth0 Bearer token flows (inherently CSRF-safe)
 *  - Webhook receivers (Stripe, etc.) which use HMAC signature validation
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
