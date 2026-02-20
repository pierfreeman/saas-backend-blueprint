import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface NotificationMessage {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  metadata?: Record<string, any> | null;
  createdAt: Date;
}

export interface BulkReadMessage {
  userId: string;
  notificationIds: string[];
}

@Injectable()
export class NotificationsPubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsPubSubService.name);
  private publisher: Redis;
  private subscriber: Redis;
  private messageHandlers: Map<string, ((message: any) => void)[]> = new Map();

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('redis.host');
    const port = this.configService.get<number>('redis.port');
    const password = this.configService.get<string>('redis.password');

    const redisConfig = {
      host,
      port,
      password,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    };

    this.publisher = new Redis(redisConfig);
    this.subscriber = new Redis(redisConfig);
  }

  async onModuleInit(): Promise<void> {
    this.publisher.on('connect', () => {
      this.logger.log('Redis publisher connected');
    });

    this.publisher.on('error', (err: Error) => {
      this.logger.error('Redis publisher error', err);
    });

    this.subscriber.on('connect', () => {
      this.logger.log('Redis subscriber connected');
    });

    this.subscriber.on('error', (err: Error) => {
      this.logger.error('Redis subscriber error', err);
    });

    this.subscriber.on('message', (channel: string, message: string) => {
      this.handleMessage(channel, message);
    });

    this.subscriber.on('pmessage', (pattern: string, _channel: string, message: string) => {
      this.handleMessage(pattern, message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting Redis pub/sub clients...');
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  private handleMessage(channel: string, message: string): void {
    try {
      const parsedMessage = JSON.parse(message);
      const handlers = this.messageHandlers.get(channel);

      if (handlers && handlers.length > 0) {
        handlers.forEach((handler) => {
          try {
            handler(parsedMessage);
          } catch (error) {
            this.logger.error(
              `Error in message handler for channel ${channel}`,
              error instanceof Error ? error.stack : 'Unknown error',
            );
          }
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to parse message from channel ${channel}`,
        error instanceof Error ? error.stack : 'Unknown error',
      );
    }
  }

  async publishNotification(userId: string, notification: NotificationMessage): Promise<void> {
    const channel = this.getUserChannel(userId);
    await this.publisher.publish(channel, JSON.stringify(notification));
    this.logger.debug(`Published notification to channel: ${channel}`);
  }

  async publishBroadcast(notification: NotificationMessage): Promise<void> {
    const channel = 'notifications:broadcast';
    await this.publisher.publish(channel, JSON.stringify(notification));
    this.logger.debug('Published broadcast notification');
  }

  async publishBulkRead(userId: string, notificationIds: string[]): Promise<void> {
    const channel = this.getUserChannel(userId);
    const message: BulkReadMessage = { userId, notificationIds };
    await this.publisher.publish(channel, JSON.stringify(message));
    this.logger.debug(`Published bulk read to channel: ${channel}`);
  }

  async subscribeToUser(
    userId: string,
    handler: (message: NotificationMessage) => void,
  ): Promise<void> {
    const channel = this.getUserChannel(userId);
    await this.subscribe(channel, handler);
  }

  async subscribeToUserPattern(handler: (message: NotificationMessage) => void): Promise<void> {
    const pattern = 'notifications:user:*';
    await this.psubscribe(pattern, handler);
  }

  async subscribeToBroadcast(handler: (message: NotificationMessage) => void): Promise<void> {
    await this.subscribe('notifications:broadcast', handler);
  }

  async unsubscribeFromUser(userId: string): Promise<void> {
    const channel = this.getUserChannel(userId);
    await this.unsubscribe(channel);
  }

  async unsubscribeFromBroadcast(): Promise<void> {
    await this.unsubscribe('notifications:broadcast');
  }

  private async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
    if (!this.messageHandlers.has(channel)) {
      this.messageHandlers.set(channel, []);
      await this.subscriber.subscribe(channel);
      this.logger.debug(`Subscribed to channel: ${channel}`);
    }

    const handlers = this.messageHandlers.get(channel)!;
    handlers.push(handler);
  }

  private async psubscribe(pattern: string, handler: (message: any) => void): Promise<void> {
    if (!this.messageHandlers.has(pattern)) {
      this.messageHandlers.set(pattern, []);
      await this.subscriber.psubscribe(pattern);
      this.logger.debug(`Pattern subscribed: ${pattern}`);
    }

    const handlers = this.messageHandlers.get(pattern)!;
    handlers.push(handler);
  }

  private async unsubscribe(channel: string): Promise<void> {
    this.messageHandlers.delete(channel);
    await this.subscriber.unsubscribe(channel);
    this.logger.debug(`Unsubscribed from channel: ${channel}`);
  }

  private getUserChannel(userId: string): string {
    return `notifications:user:${userId}`;
  }

  getPublisher(): Redis {
    return this.publisher;
  }

  getSubscriber(): Redis {
    return this.subscriber;
  }
}
