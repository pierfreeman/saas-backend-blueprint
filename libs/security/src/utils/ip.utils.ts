import type { Request } from 'express';

/**
 * Extracts the real client IP from an Express request.
 *
 * Priority order:
 *  1. X-Forwarded-For (first entry — set by reverse proxies / load balancers)
 *  2. X-Real-IP (set by nginx)
 *  3. socket.remoteAddress (direct connection)
 *
 * Security note: X-Forwarded-For can be spoofed by clients unless your
 * infrastructure validates/overwrites it. Rely on it only when your proxy
 * is the sole entry point (i.e. direct client connections are impossible).
 */
export function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const ip = first.split(',')[0].trim();
    if (ip) return ip;
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0].trim() : realIp.trim();
  }

  return req.socket?.remoteAddress ?? '127.0.0.1';
}

/**
 * Checks whether an IP address string is a valid IPv4 or IPv6 address.
 * Accepts optional CIDR notation stripped before evaluation.
 */
export function isValidIp(ip: string): boolean {
  const stripped = ip.split('/')[0];
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(stripped) || /^[0-9a-fA-F:]+$/.test(stripped)
  );
}
