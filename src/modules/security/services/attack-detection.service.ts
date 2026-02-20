import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { RedisService } from '../../../redis/redis.service';
import { SecurityRequest } from '../types/security-request.interface';

interface RateLimitResult {
  blocked: boolean;
  key: string;
  count: number;
  limit: number;
  retryAfterSeconds: number;
}

interface BruteForceStatus {
  blocked: boolean;
  retryAfterSeconds: number;
  identifier: string;
}

@Injectable()
export class AttackDetectionService {
  private readonly rateLimitRequests: number;
  private readonly rateLimitWindowMs: number;
  private readonly rateLimitBurst: number;
  private readonly bruteForceMaxAttempts: number;
  private readonly bruteForceBlockMs: number;
  private readonly suspiciousScoreThreshold: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.rateLimitRequests = this.getNumberEnv('RATE_LIMIT_REQUESTS', 100);
    this.rateLimitWindowMs = this.getNumberEnv('RATE_LIMIT_WINDOW_MS', 60000);
    this.rateLimitBurst = this.getNumberEnv('RATE_LIMIT_BURST', 20);
    this.bruteForceMaxAttempts = this.getNumberEnv('BRUTE_FORCE_MAX_ATTEMPTS', 5);
    this.bruteForceBlockMs = this.getNumberEnv('BRUTE_FORCE_BLOCK_MS', 900000);
    this.suspiciousScoreThreshold = this.getNumberEnv('SUSPICIOUS_SCORE_THRESHOLD', 20);
  }

  async checkRateLimit(request: Request): Promise<RateLimitResult> {
    const identity = this.getIdentity(request);
    const route = this.normalizeEndpoint(identity.endpoint);
    const suspiciousScore = await this.getSuspiciousScore(identity.ip);
    const dynamicLimit =
      suspiciousScore >= this.suspiciousScoreThreshold
        ? Math.max(Math.floor(this.rateLimitRequests / 2), 10)
        : this.rateLimitRequests;
    const effectiveLimit = dynamicLimit + this.rateLimitBurst;

    const key = `sec:rl:${route}:${identity.method}:${identity.ip}:${identity.userId || 'anonymous'}`;

    const count = await this.redisService.incr(key);
    if (count === 1) {
      await this.redisService.expire(key, Math.ceil(this.rateLimitWindowMs / 1000));
    }

    const retryAfterSeconds = Math.max(await this.redisService.ttl(key), 1);
    const blocked = count > effectiveLimit;

    return {
      blocked,
      key,
      count,
      limit: effectiveLimit,
      retryAfterSeconds,
    };
  }

  async getBruteForceStatus(request: Request, userIdentifier?: string): Promise<BruteForceStatus> {
    const ip = this.extractIp(request);
    const identity = userIdentifier?.trim().toLowerCase() || 'anonymous';

    const ipBlockKey = this.getBruteForceBlockKey(`ip:${ip}`);
    const identityBlockKey = this.getBruteForceBlockKey(`id:${identity}`);

    const [ipTtl, identityTtl] = await Promise.all([
      this.redisService.ttl(ipBlockKey),
      this.redisService.ttl(identityBlockKey),
    ]);

    const retryAfterSeconds = Math.max(ipTtl, identityTtl, 0);

    return {
      blocked: retryAfterSeconds > 0,
      retryAfterSeconds,
      identifier: identity,
    };
  }

  async registerAuthFailure(request: Request, userIdentifier?: string): Promise<void> {
    const ip = this.extractIp(request);
    const identity = userIdentifier?.trim().toLowerCase() || 'anonymous';

    await Promise.all([
      this.incrementAuthFailure(`ip:${ip}`),
      this.incrementAuthFailure(`id:${identity}`),
      this.registerSuspiciousByIp(ip, 'auth_failure'),
    ]);
  }

  async clearAuthFailures(request: Request, userIdentifier?: string): Promise<void> {
    const ip = this.extractIp(request);
    const identity = userIdentifier?.trim().toLowerCase() || 'anonymous';

    await Promise.all([
      this.redisService.del(this.getBruteForceAttemptsKey(`ip:${ip}`)),
      this.redisService.del(this.getBruteForceAttemptsKey(`id:${identity}`)),
    ]);
  }

  async registerSuspiciousActivity(request: Request, reason: string): Promise<void> {
    const ip = this.extractIp(request);
    await this.registerSuspiciousByIp(ip, reason);
  }

  async isSuspiciouslyBlocked(request: Request): Promise<boolean> {
    const ip = this.extractIp(request);
    const ttl = await this.redisService.ttl(this.getSuspiciousBlockKey(ip));
    return ttl > 0;
  }

  getIdentity(request: Request): {
    ip: string;
    endpoint: string;
    method: string;
    userId?: string;
    orgId?: string;
  } {
    const securityRequest = request as SecurityRequest;
    const userId = this.extractUserId(securityRequest);
    const orgId = this.extractOrgId(securityRequest);

    return {
      ip: this.extractIp(request),
      endpoint: request.path || request.url,
      method: request.method,
      userId,
      orgId,
    };
  }

  attachReason(request: Request, reason: string): void {
    const securityRequest = request as SecurityRequest;
    const identity = this.getIdentity(request);

    if (!securityRequest.securityContext) {
      securityRequest.securityContext = {
        ip: identity.ip,
        endpoint: identity.endpoint,
        method: identity.method,
        userId: identity.userId,
        orgId: identity.orgId,
        reasons: [],
        threatScore: 0,
      };
    }

    securityRequest.securityContext.reasons.push(reason);
    securityRequest.securityContext.threatScore += 1;
  }

  hasMalformedSignals(request: Request): boolean {
    const queryString = JSON.stringify(request.query || {});
    const path = request.path || request.url;

    const malformedPathRegex = /(%00|%3C|%3E|\.\.|<|>|\{|\})/i;
    const malformedQueryRegex = /(\$where|\$ne|\$gt|\$lt|union\s+select|sleep\(|benchmark\()/i;

    return malformedPathRegex.test(path) || malformedQueryRegex.test(queryString);
  }

  private async incrementAuthFailure(keySuffix: string): Promise<void> {
    const attemptsKey = this.getBruteForceAttemptsKey(keySuffix);
    const attempts = await this.redisService.incr(attemptsKey);
    if (attempts === 1) {
      await this.redisService.expire(attemptsKey, Math.ceil(this.bruteForceBlockMs / 1000));
    }

    if (attempts >= this.bruteForceMaxAttempts) {
      const blockKey = this.getBruteForceBlockKey(keySuffix);
      await this.redisService.set(blockKey, '1', Math.ceil(this.bruteForceBlockMs / 1000));
      await this.redisService.del(attemptsKey);
    }
  }

  private async registerSuspiciousByIp(ip: string, reason: string): Promise<void> {
    const scoreKey = `sec:susp:score:${ip}`;
    const reasonKey = `sec:susp:reason:${ip}`;
    const score = await this.redisService.incr(scoreKey);

    if (score === 1) {
      await this.redisService.expire(scoreKey, 600);
      await this.redisService.expire(reasonKey, 600);
    }

    await this.redisService.set(reasonKey, reason, 600);

    if (score >= this.suspiciousScoreThreshold) {
      await this.redisService.set(this.getSuspiciousBlockKey(ip), '1', 300);
    }
  }

  private async getSuspiciousScore(ip: string): Promise<number> {
    const value = await this.redisService.get(`sec:susp:score:${ip}`);
    if (!value) {
      return 0;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private getBruteForceAttemptsKey(identity: string): string {
    return `sec:bf:attempts:${identity}`;
  }

  private getBruteForceBlockKey(identity: string): string {
    return `sec:bf:block:${identity}`;
  }

  private getSuspiciousBlockKey(ip: string): string {
    return `sec:susp:block:${ip}`;
  }

  private normalizeEndpoint(endpoint: string): string {
    return endpoint.replace(/[^a-zA-Z0-9:/_-]/g, '_').replace(/\/+$/g, '') || '/';
  }

  private extractIp(request: Request): string {
    const xForwardedFor = request.headers['x-forwarded-for'];

    if (typeof xForwardedFor === 'string' && xForwardedFor.length > 0) {
      return xForwardedFor.split(',')[0].trim();
    }

    return request.ip || request.socket.remoteAddress || 'unknown';
  }

  private extractUserId(request: SecurityRequest): string | undefined {
    if (request.user?.id) {
      return request.user.id;
    }

    if (request.user?.sub) {
      return request.user.sub;
    }

    const authorizationHeader = request.headers.authorization;
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return undefined;
    }

    const token = authorizationHeader.replace('Bearer ', '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) {
      return undefined;
    }

    try {
      const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payloadBuffer = Buffer.from(payloadBase64, 'base64');
      const payload = JSON.parse(payloadBuffer.toString('utf8')) as { sub?: string };
      return payload.sub;
    } catch {
      return undefined;
    }
  }

  private extractOrgId(request: SecurityRequest): string | undefined {
    const orgHeader = request.headers['x-org-id'];
    if (typeof orgHeader === 'string' && orgHeader.length > 0) {
      return orgHeader;
    }

    if (request.user?.orgId) {
      return request.user.orgId;
    }

    return undefined;
  }

  private getNumberEnv(key: string, defaultValue: number): number {
    const raw = this.configService.get<string | number>(key);
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }

    if (typeof raw === 'string') {
      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return defaultValue;
  }
}
