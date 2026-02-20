import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { NotificationsGateway } from '../../src/modules/notifications/gateway/notifications.gateway';
import { NotificationsPubSubService } from '../../src/modules/notifications/redis/notifications-pubsub.service';
import { NotificationsService } from '../../src/modules/notifications/services/notifications.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('NotificationsGateway Integration', () => {
  let app: INestApplication;
  let gateway: NotificationsGateway;
  let pubSubService: NotificationsPubSubService;
  let clientSocket: ClientSocket;
  let initialUnreadCount: { count: number } | null = null;

  const mockUserId = 'test-user-123';
  const mockToken = 'mock-jwt-token';

  beforeAll(async () => {
    const mockConfigService = {
      get: jest.fn((key: string) => {
        const config: Record<string, any> = {
          'redis.host': process.env.REDIS_HOST || 'localhost',
          'redis.port': parseInt(process.env.REDIS_PORT || '6379'),
          'redis.password': process.env.REDIS_PASSWORD || '',
          'auth.domain': 'test.auth0.com',
          'auth.audience': 'test-api',
        };
        return config[key];
      }),
    };

    const mockJwtService = {
      decode: jest.fn(() => ({
        sub: mockUserId,
        email: 'test@example.com',
      })),
    };

    const mockPrismaService = {
      notification: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsGateway,
        NotificationsPubSubService,
        NotificationsService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    app = module.createNestApplication();
    await app.listen(0); // Random port

    gateway = module.get<NotificationsGateway>(NotificationsGateway);
    pubSubService = module.get<NotificationsPubSubService>(NotificationsPubSubService);

    // Get the actual port
    const address = app.getHttpServer().address();
    const port = address.port;

    // Create client socket
    clientSocket = io(`http://localhost:${port}/notifications`, {
      auth: { token: mockToken },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });

    const initialUnreadCountPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out waiting for initial unread count event'));
      }, 5000);

      clientSocket.once('notification:unread-count', (data) => {
        initialUnreadCount = data;
        clearTimeout(timeout);
        resolve();
      });
    });

    const connectPromise = new Promise<void>((resolve, reject) => {
      clientSocket.once('connect', () => resolve());
      clientSocket.once('connect_error', (error) => reject(error));
    });

    clientSocket.connect();

    await Promise.all([connectPromise, initialUnreadCountPromise]);
  });

  afterAll(async () => {
    clientSocket.close();
    await app.close();
  });

  describe('Connection', () => {
    it('should connect with valid token', () => {
      expect(clientSocket.connected).toBe(true);
    });

    it('should receive initial unread count', () => {
      expect(initialUnreadCount).toBeDefined();
      expect(initialUnreadCount).toHaveProperty('count');
      expect(typeof initialUnreadCount?.count).toBe('number');
    });
  });

  describe('Real-time notification delivery', () => {
    it('should receive notification via Redis pub/sub', (done) => {
      const notification = {
        notificationId: 'test-notif-123',
        userId: mockUserId,
        type: 'info',
        title: 'Test Real-time',
        body: 'This is a real-time notification',
        createdAt: new Date(),
      };

      clientSocket.once('notification:new', (data) => {
        expect(data.notificationId).toBe(notification.notificationId);
        expect(data.type).toBe(notification.type);
        expect(data.title).toBe(notification.title);
        done();
      });

      // Publish via Redis
      setTimeout(() => {
        pubSubService.publishNotification(mockUserId, notification);
      }, 100);
    }, 3000);
  });

  describe('WebSocket events', () => {
    it('should respond to notification:get-all', (done) => {
      clientSocket.emit('notification:get-all', { limit: 10, skip: 0 });

      clientSocket.once('notification:list', (data) => {
        expect(Array.isArray(data)).toBe(true);
        done();
      });
    }, 3000);
  });
});
