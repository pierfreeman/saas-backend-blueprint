import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** Handler called when a message arrives on a subscribed channel. */
export type PubSubHandler = (payload: unknown) => void;

/**
 * Handler called when a message matches a pSubscribe pattern.
 * @param channel - the exact channel the message was published on
 * @param payload - the parsed JSON payload
 */
export type PatternHandler = (channel: string, payload: unknown) => void;

/**
 * Pub/Sub Service
 *
 * Provides publishing and subscription of events via Redis.
 *
 * Two dedicated ioredis connections are maintained:
 *   - `publisher`  — used exclusively for PUBLISH commands.
 *   - `subscriber` — used exclusively for SUBSCRIBE / PSUBSCRIBE.
 *
 * Redis mandates that a connection in subscribe mode can only issue
 * sub/unsub commands; mixing publish calls on the same connection
 * causes protocol errors.  The two-connection pattern is the canonical
 * solution (same approach used by ioredis documentation and BullMQ).
 */
@Injectable()
export class PubSubService implements OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);

  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor() {
    const opts = {
      host: process.env['REDIS_HOST'] ?? 'localhost',
      port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    };

    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);

    this.publisher.on('connect', () =>
      this.logger.log('Redis publisher connected'),
    );
    this.publisher.on('error', (err) =>
      this.logger.error('Redis publisher error', err),
    );

    this.subscriber.on('connect', () =>
      this.logger.log('Redis subscriber connected'),
    );
    this.subscriber.on('error', (err) =>
      this.logger.error('Redis subscriber error', err),
    );
  }

  // ── Publish ───────────────────────────────────────────────────────────────

  /**
   * Serialise `payload` to JSON and publish it on `channel`.
   * @throws when the Redis PUBLISH command fails.
   */
  async publish(channel: string, payload: unknown): Promise<void> {
    try {
      const message = JSON.stringify(payload);
      const receivers = await this.publisher.publish(channel, message);
      this.logger.debug(
        `Published to "${channel}" — ${receivers} subscriber(s)`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish to "${channel}":`, error);
      throw error;
    }
  }

  // ── Subscribe ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to an exact Redis channel.
   *
   * `handler` is invoked with the parsed JSON payload for every incoming
   * message on `channel`.  Multiple handlers may be registered for the
   * same channel; each is called independently.
   */
  subscribe(channel: string, handler: PubSubHandler): void {
    void this.subscriber.subscribe(channel);

    this.subscriber.on('message', (ch: string, raw: string) => {
      if (ch !== channel) return;
      try {
        handler(JSON.parse(raw));
      } catch {
        this.logger.error(`Failed to parse message from channel "${ch}"`);
      }
    });

    this.logger.log(`Subscribed to channel: "${channel}"`);
  }

  /**
   * Subscribe to a Redis channel pattern (glob-style, e.g. `job:update:*`).
   *
   * `handler` is called with the exact matched channel name and the
   * parsed JSON payload.  Multiple handlers may be registered for the
   * same pattern.
   */
  pSubscribe(pattern: string, handler: PatternHandler): void {
    void this.subscriber.psubscribe(pattern);

    this.subscriber.on('pmessage', (_pat: string, ch: string, raw: string) => {
      try {
        handler(ch, JSON.parse(raw));
      } catch {
        this.logger.error(`Failed to parse pmessage from channel "${ch}"`);
      }
    });

    this.logger.log(`Pattern-subscribed to: "${pattern}"`);
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  /**
   * Expose the publisher connection for advanced use-cases
   * (e.g. SET / GET operations that must not conflict with subscribe mode).
   */
  getRedis(): Redis {
    return this.publisher;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting Redis Pub/Sub connections...');
    await Promise.all([this.publisher.quit(), this.subscriber.quit()]);
  }
}
