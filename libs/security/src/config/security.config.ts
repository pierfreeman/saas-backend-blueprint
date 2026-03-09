import { registerAs } from '@nestjs/config';

/**
 * Security configuration factory.
 *
 * All values are sourced exclusively from environment variables — no
 * hard-coded secrets or environment-specific defaults beyond safe
 * development fallbacks.
 *
 * Registered under the 'security' namespace:
 *   configService.get('security.cors.allowedOrigins')
 */
export default registerAs('security', () => ({
  cors: {
    /**
     * Comma-separated list of allowed origins.
     * Example: "https://app.example.com,https://admin.example.com"
     */
    allowedOrigins: (process.env['CORS_ALLOWED_ORIGINS'] ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    /** Whether to allow credentials (cookies, auth headers) in CORS requests */
    credentials: process.env['CORS_CREDENTIALS'] !== 'false',
  },

  rateLimit: {
    /** Sliding-window size in seconds */
    ttl: Number.parseInt(process.env['RATE_LIMIT_TTL'] ?? '60', 10),
    /** Max requests per window per IP */
    maxPerIp: Number.parseInt(
      process.env['RATE_LIMIT_MAX_PER_IP'] ?? '100',
      10,
    ),
    /** Max requests per window per authenticated user */
    maxPerUser: Number.parseInt(
      process.env['RATE_LIMIT_MAX_PER_USER'] ?? '200',
      10,
    ),
    /** Max requests per window per tenant/organisation */
    maxPerTenant: Number.parseInt(
      process.env['RATE_LIMIT_MAX_PER_TENANT'] ?? '1000',
      10,
    ),
  },

  bruteForce: {
    /** Max failed auth attempts before lockout */
    maxAttempts: Number.parseInt(
      process.env['BRUTE_FORCE_MAX_ATTEMPTS'] ?? '5',
      10,
    ),
    /** How long (seconds) the lockout lasts once triggered */
    lockoutTtl: Number.parseInt(
      process.env['BRUTE_FORCE_LOCKOUT_TTL'] ?? '900',
      10,
    ),
    /** How long (seconds) failed-attempt counters are tracked */
    trackingTtl: Number.parseInt(
      process.env['BRUTE_FORCE_TRACKING_TTL'] ?? '3600',
      10,
    ),
  },

  csrf: {
    /**
     * Enable CSRF double-submit cookie protection.
     * Only relevant for cookie-based auth flows.
     * Auth0 Bearer token flows are inherently CSRF-safe and do NOT require this.
     */
    enabled: process.env['CSRF_PROTECTION_ENABLED'] === 'true',
    cookieName: process.env['CSRF_COOKIE_NAME'] ?? '__csrf',
    headerName: process.env['CSRF_HEADER_NAME'] ?? 'x-csrf-token',
    /** Set the cookie Secure flag (forced to true in production) */
    secureCookie: process.env['NODE_ENV'] === 'production',
  },

  ipFilter: {
    /** Enable IP allowlist — only listed IPs are allowed */
    allowlistEnabled: process.env['IP_ALLOWLIST_ENABLED'] === 'true',
    allowedIps: (process.env['IP_ALLOWLIST'] ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
    /** Enable IP denylist — listed IPs are always blocked */
    denylistEnabled: process.env['IP_DENYLIST_ENABLED'] === 'true',
    deniedIps: (process.env['IP_DENYLIST'] ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean),
  },

  websocket: {
    /** Enable per-connection message-rate limiting */
    rateLimitEnabled: process.env['WS_RATE_LIMIT_ENABLED'] !== 'false',
    /** Max WebSocket messages per minute per connection */
    maxMessagesPerMinute: Number.parseInt(
      process.env['WS_RATE_LIMIT_MAX_MESSAGES_PER_MINUTE'] ?? '60',
      10,
    ),
  },

  /**
   * Maximum accepted request body size.
   * Accepts human-readable strings: "2mb", "500kb", "1024" (bytes).
   * Enforced by RequestSizeLimitMiddleware before body is parsed.
   */
  maxBodySize: process.env['MAX_BODY_SIZE'] ?? '2mb',

  payloadSanitization: {
    /**
     * Enable payload sanitization middleware.
     * Detects SQL injection, NoSQL operator injection, and XSS fragments.
     * Disable only in environments where input is fully trusted (e.g., internal tooling).
     */
    enabled: process.env['PAYLOAD_SANITIZATION_ENABLED'] !== 'false',
  },
}));
