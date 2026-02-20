import { INestApplication, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { TestAppFactory } from '../setup/test-app.factory';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtAuthGuard } from '../../src/modules/auth/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';

const TEST_USER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEST_AUTH0_ID = TEST_USER_ID; // mock guard sets sub = DB UUID directly

class MockJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers.authorization as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Authentication required');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    if (token !== 'mock-jwt-token') {
      throw new UnauthorizedException('Authentication required');
    }

    req.user = { sub: TEST_AUTH0_ID, email: 'notif-e2e@test.com' };
    return true;
  }
}

// Mocks jwtService.decode() so the WebSocket gateway can resolve the user
const mockJwtService = {
  decode: (token: string) => {
    if (token === 'mock-jwt-token') {
      return { sub: TEST_AUTH0_ID, email: 'notif-e2e@test.com' };
    }
    return null;
  },
};

describe('Notifications E2E Tests', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authToken: string;
  let userId: string;
  let clientSocket: ClientSocket;
  let serverUrl: string;

  beforeAll(async () => {
    app = await TestAppFactory.createApp({
      guards: [{ provide: JwtAuthGuard, useValue: new MockJwtAuthGuard() }],
      providers: [{ provide: JwtService, useValue: mockJwtService }],
    });
    prisma = app.get(PrismaService);

    // Get server address
    const address = app.getHttpServer().address();
    const port = (address as { port: number }).port;
    serverUrl = `http://localhost:${port}`;

    // Create test user
    userId = TEST_USER_ID;
    await prisma.user.upsert({
      where: { auth0Id: TEST_AUTH0_ID },
      create: {
        id: userId,
        auth0Id: TEST_AUTH0_ID,
        email: 'notif-e2e@test.com',
      },
      update: {},
    });

    // Mock JWT token
    authToken = 'Bearer mock-jwt-token';
  });

  afterAll(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.close();
    }
    await TestAppFactory.cleanup(app);
  });

  beforeEach(async () => {
    // Clean notifications before each test
    await prisma.notification.deleteMany({
      where: { userId },
    });
  });

  describe('REST API', () => {
    describe('POST /notifications', () => {
      it('should create notification via REST', async () => {
        const response = await request(app.getHttpServer())
          .post('/notifications')
          .set('Authorization', authToken)
          .send({
            type: 'info',
            title: 'Test Notification',
            body: 'This is a test notification via REST',
          });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body.type).toBe('info');
        expect(response.body.title).toBe('Test Notification');
        expect(response.body.readAt).toBeNull();
      });

      it('should return 400 with invalid data', async () => {
        const response = await request(app.getHttpServer())
          .post('/notifications')
          .set('Authorization', authToken)
          .send({
            type: '',
            title: '',
            body: '',
          });

        expect(response.status).toBe(400);
      });

      it('should return 401 without authentication', async () => {
        const response = await request(app.getHttpServer()).post('/notifications').send({
          type: 'info',
          title: 'Test',
          body: 'Test body',
        });

        expect(response.status).toBe(401);
      });
    });

    describe('GET /notifications', () => {
      beforeEach(async () => {
        // Create some test notifications
        await prisma.notification.createMany({
          data: [
            {
              userId,
              type: 'info',
              title: 'Notification 1',
              body: 'Body 1',
            },
            {
              userId,
              type: 'warning',
              title: 'Notification 2',
              body: 'Body 2',
            },
            {
              userId,
              type: 'error',
              title: 'Notification 3',
              body: 'Body 3',
              readAt: new Date(),
            },
          ],
        });
      });

      it('should return all notifications', async () => {
        const response = await request(app.getHttpServer())
          .get('/notifications')
          .set('Authorization', authToken);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(3);
      });

      it('should return only unread notifications', async () => {
        const response = await request(app.getHttpServer())
          .get('/notifications?unreadOnly=true')
          .set('Authorization', authToken);

        expect(response.status).toBe(200);
        expect(response.body.length).toBe(2);
        expect(response.body.every((n: any) => n.readAt === null)).toBe(true);
      });

      it('should respect limit parameter', async () => {
        const response = await request(app.getHttpServer())
          .get('/notifications?limit=2')
          .set('Authorization', authToken);

        expect(response.status).toBe(200);
        expect(response.body.length).toBe(2);
      });
    });

    describe('GET /notifications/unread-count', () => {
      beforeEach(async () => {
        await prisma.notification.createMany({
          data: [
            { userId, type: 'info', title: 'Unread 1', body: 'Body 1' },
            { userId, type: 'info', title: 'Unread 2', body: 'Body 2' },
            {
              userId,
              type: 'info',
              title: 'Read',
              body: 'Body',
              readAt: new Date(),
            },
          ],
        });
      });

      it('should return unread count', async () => {
        const response = await request(app.getHttpServer())
          .get('/notifications/unread-count')
          .set('Authorization', authToken);

        expect(response.status).toBe(200);
        expect(response.body.count).toBe(2);
      });
    });

    describe('PATCH /notifications/:id/read', () => {
      it('should mark notification as read', async () => {
        // Create notification
        const notification = await prisma.notification.create({
          data: {
            userId,
            type: 'info',
            title: 'To Mark Read',
            body: 'Body',
          },
        });

        const response = await request(app.getHttpServer())
          .patch(`/notifications/${notification.id}/read`)
          .set('Authorization', authToken);

        expect(response.status).toBe(200);
        expect(response.body.readAt).toBeDefined();
        expect(response.body.readAt).not.toBeNull();
      });

      it('should return 404 for non-existent notification', async () => {
        const response = await request(app.getHttpServer())
          .patch('/notifications/00000000-0000-4000-8000-000000000000/read')
          .set('Authorization', authToken);

        expect(response.status).toBe(404);
      });
    });

    describe('DELETE /notifications/:id', () => {
      it('should delete notification', async () => {
        const notification = await prisma.notification.create({
          data: {
            userId,
            type: 'info',
            title: 'To Delete',
            body: 'Body',
          },
        });

        const response = await request(app.getHttpServer())
          .delete(`/notifications/${notification.id}`)
          .set('Authorization', authToken);

        expect(response.status).toBe(204);

        // Verify deleted
        const deleted = await prisma.notification.findUnique({
          where: { id: notification.id },
        });
        expect(deleted).toBeNull();
      });
    });
  });

  describe('WebSocket', () => {
    beforeEach((done) => {
      // Connect WebSocket client
      clientSocket = io(`${serverUrl}/notifications`, {
        auth: { token: 'mock-jwt-token' },
        transports: ['websocket'],
        reconnection: false,
      });

      clientSocket.on('connect', () => {
        done();
      });
    });

    afterEach(() => {
      if (clientSocket && clientSocket.connected) {
        clientSocket.close();
      }
    });

    it('should connect to WebSocket with authentication', () => {
      expect(clientSocket.connected).toBe(true);
    });

    it('should receive initial unread count on connection', (done) => {
      clientSocket.on('notification:unread-count', (data) => {
        expect(data).toHaveProperty('count');
        expect(typeof data.count).toBe('number');
        done();
      });
    }, 3000);

    it('should receive notification in real-time when created via REST', (done) => {
      clientSocket.once('notification:new', (data) => {
        expect(data.type).toBe('realtime-test');
        expect(data.title).toBe('Real-time Notification');
        done();
      });

      // Create notification via REST API
      setTimeout(() => {
        request(app.getHttpServer())
          .post('/notifications')
          .set('Authorization', authToken)
          .send({
            type: 'realtime-test',
            title: 'Real-time Notification',
            body: 'This should be received via WebSocket',
          })
          .end();
      }, 100);
    }, 5000);

    it('should mark notification as read via WebSocket', (done) => {
      // Create notification first
      prisma.notification
        .create({
          data: {
            userId,
            type: 'info',
            title: 'To Mark Read via WS',
            body: 'Body',
          },
        })
        .then((notification) => {
          clientSocket.emit('notification:mark-read', {
            notificationId: notification.id,
          });

          clientSocket.once('notification:read', (data) => {
            expect(data.id).toBe(notification.id);
            expect(data.readAt).toBeDefined();
            done();
          });
        });
    }, 5000);

    it('should mark all as read via WebSocket', (done) => {
      // Create multiple notifications
      prisma.notification
        .createMany({
          data: [
            { userId, type: 'info', title: 'Unread 1', body: 'Body 1' },
            { userId, type: 'info', title: 'Unread 2', body: 'Body 2' },
          ],
        })
        .then(() => {
          clientSocket.emit('notification:mark-all-read');

          clientSocket.once('notification:bulk-read', (data) => {
            expect(data.count).toBeGreaterThan(0);
            done();
          });
        });
    }, 5000);

    it('should get all notifications via WebSocket', (done) => {
      prisma.notification
        .createMany({
          data: [
            { userId, type: 'info', title: 'WS Notif 1', body: 'Body 1' },
            { userId, type: 'info', title: 'WS Notif 2', body: 'Body 2' },
          ],
        })
        .then(() => {
          clientSocket.emit('notification:get-all', { limit: 10, skip: 0 });

          clientSocket.once('notification:list', (data) => {
            expect(Array.isArray(data)).toBe(true);
            expect(data.length).toBeGreaterThanOrEqual(2);
            done();
          });
        });
    }, 5000);
  });

  describe('Full Flow: Create -> Receive -> Mark Read', () => {
    it('should complete full notification flow', (done) => {
      let notificationId: string;
      let step = 0;

      // Connect WebSocket
      const testSocket = io(`${serverUrl}/notifications`, {
        auth: { token: 'mock-jwt-token' },
        transports: ['websocket'],
        reconnection: false,
      });

      testSocket.on('connect', () => {
        step = 1;

        // Step 1: Listen for new notification
        testSocket.once('notification:new', (data) => {
          step = 2;
          notificationId = data.notificationId;
          expect(data.title).toBe('Full Flow Test');

          // Step 2: Mark as read
          testSocket.emit('notification:mark-read', { notificationId });
        });

        // Step 3: Confirm marked as read
        testSocket.once('notification:read', (data) => {
          step = 3;
          expect(data.id).toBe(notificationId);
          expect(data.readAt).toBeDefined();

          testSocket.close();
          done();
        });

        // Create notification after 100ms
        setTimeout(() => {
          request(app.getHttpServer())
            .post('/notifications')
            .set('Authorization', authToken)
            .send({
              type: 'flow-test',
              title: 'Full Flow Test',
              body: 'Testing complete notification flow',
            })
            .end();
        }, 100);
      });
    }, 10000);
  });
});
