import { Redis } from 'ioredis';

/**
 * TestRedis class manages a Redis connection for testing
 * Can be used with a Redis container or local Redis instance
 */
export class TestRedis {
  private client: Redis | null = null;
  private host: string = 'localhost';
  private port: number = 6379;

  constructor(host = 'localhost', port = 6379) {
    this.host = host;
    this.port = port;
  }

  /**
   * Connects to Redis
   */
  async connect(): Promise<void> {
    console.log(`Connecting to Redis at ${this.host}:${this.port}...`);

    this.client = new Redis({
      host: this.host,
      port: this.port,
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 100, 3000);
      },
    });

    await this.client.ping();
    console.log('Connected to Redis successfully');
  }

  /**
   * Disconnects from Redis
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      console.log('Disconnected from Redis');
    }
  }

  /**
   * Gets the Redis client
   */
  getClient(): Redis {
    if (!this.client) {
      throw new Error('Redis client not initialized. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Flushes all data from Redis
   */
  async flush(): Promise<void> {
    if (this.client) {
      await this.client.flushall();
      console.log('Redis flushed');
    }
  }

  /**
   * Sets a value with optional TTL
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.client) return;

    if (ttl) {
      await this.client.setex(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * Gets a value
   */
  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  /**
   * Deletes keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    if (!this.client) return;

    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}
