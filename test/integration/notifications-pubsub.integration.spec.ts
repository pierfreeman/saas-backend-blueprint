import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  NotificationsPubSubService,
  NotificationMessage,
} from '../../src/modules/notifications/redis/notifications-pubsub.service';

describe('NotificationsPubSubService Integration', () => {
  let service: NotificationsPubSubService;
  let receivedMessages: NotificationMessage[] = [];

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          'redis.host': process.env.REDIS_HOST || 'localhost',
          'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
          'redis.password': process.env.REDIS_PASSWORD || '',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsPubSubService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<NotificationsPubSubService>(NotificationsPubSubService);
    await service.onModuleInit();
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  beforeEach(() => {
    receivedMessages = [];
  });

  describe('User-specific notifications', () => {
    it('should publish and receive notification for specific user', async () => {
      const userId = 'test-user-123';
      const notification: NotificationMessage = {
        notificationId: 'notif-123',
        userId,
        type: 'info',
        title: 'Test Notification',
        body: 'This is a test',
        createdAt: new Date(),
      };

      // Subscribe to user channel
      const messagePromise = new Promise<NotificationMessage>((resolve) => {
        service.subscribeToUser(userId, (message) => {
          resolve(message);
        });
      });

      // Wait a bit for subscription to be ready
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish notification
      await service.publishNotification(userId, notification);

      // Wait for message
      const receivedMessage = await Promise.race([
        messagePromise,
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
      ]);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.notificationId).toBe(notification.notificationId);
      expect(receivedMessage!.userId).toBe(userId);
      expect(receivedMessage!.type).toBe(notification.type);

      // Cleanup
      await service.unsubscribeFromUser(userId);
    });

    it('should not receive notification for different user', async () => {
      const userId1 = 'user-1';
      const userId2 = 'user-2';
      const notification: NotificationMessage = {
        notificationId: 'notif-456',
        userId: userId2,
        type: 'info',
        title: 'For User 2',
        body: 'This is for user 2 only',
        createdAt: new Date(),
      };

      let receivedCount = 0;

      // Subscribe user1 to their channel
      await service.subscribeToUser(userId1, () => {
        receivedCount++;
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish to user2
      await service.publishNotification(userId2, notification);

      // Wait to ensure message is not received
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedCount).toBe(0);

      // Cleanup
      await service.unsubscribeFromUser(userId1);
    });
  });

  describe('Pattern subscription', () => {
    it('should receive all user notifications with pattern subscription', async () => {
      const userId1 = 'pattern-user-1';
      const userId2 = 'pattern-user-2';

      const receivedUserIds: string[] = [];

      // Subscribe to pattern
      await service.subscribeToUserPattern((message) => {
        receivedUserIds.push(message.userId);
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish to both users
      await service.publishNotification(userId1, {
        notificationId: 'notif-1',
        userId: userId1,
        type: 'info',
        title: 'Test 1',
        body: 'Body 1',
        createdAt: new Date(),
      });

      await service.publishNotification(userId2, {
        notificationId: 'notif-2',
        userId: userId2,
        type: 'info',
        title: 'Test 2',
        body: 'Body 2',
        createdAt: new Date(),
      });

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedUserIds).toContain(userId1);
      expect(receivedUserIds).toContain(userId2);
    });
  });

  describe('Broadcast notifications', () => {
    it('should publish and receive broadcast notification', async () => {
      const notification: NotificationMessage = {
        notificationId: 'broadcast-123',
        userId: 'system',
        type: 'announcement',
        title: 'System Announcement',
        body: 'Maintenance scheduled',
        createdAt: new Date(),
      };

      const messagePromise = new Promise<NotificationMessage>((resolve) => {
        service.subscribeToBroadcast((message) => {
          resolve(message);
        });
      });

      // Wait for subscription
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish broadcast
      await service.publishBroadcast(notification);

      // Wait for message
      const receivedMessage = await Promise.race([
        messagePromise,
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
      ]);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.type).toBe('announcement');
      expect(receivedMessage!.title).toBe('System Announcement');

      // Cleanup
      await service.unsubscribeFromBroadcast();
    });
  });

  describe('Multiple handlers', () => {
    it('should call multiple handlers for same channel', async () => {
      const userId = 'multi-handler-user';
      const callCounts = [0, 0, 0];

      // Subscribe with multiple handlers
      await service.subscribeToUser(userId, () => {
        callCounts[0]++;
      });
      await service.subscribeToUser(userId, () => {
        callCounts[1]++;
      });
      await service.subscribeToUser(userId, () => {
        callCounts[2]++;
      });

      // Wait for subscriptions
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish one notification
      await service.publishNotification(userId, {
        notificationId: 'multi-123',
        userId,
        type: 'info',
        title: 'Multi Handler Test',
        body: 'Testing multiple handlers',
        createdAt: new Date(),
      });

      // Wait for handlers to execute
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(callCounts[0]).toBe(1);
      expect(callCounts[1]).toBe(1);
      expect(callCounts[2]).toBe(1);

      // Cleanup
      await service.unsubscribeFromUser(userId);
    });
  });
});
