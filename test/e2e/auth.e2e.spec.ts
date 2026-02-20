import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { TestAppFactory } from '../setup/test-app.factory';

describe('Auth E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await TestAppFactory.createApp();
  });

  afterAll(async () => {
    await TestAppFactory.cleanup(app);
  });

  describe('Protected Routes', () => {
    it('should return 401 for /organizations without token', async () => {
      const response = await request(app.getHttpServer()).get('/organizations');

      expect(response.status).toBe(401);
    });

    it('should return 401 for /teams without token', async () => {
      const orgId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app.getHttpServer()).get(`/organizations/${orgId}/teams`);

      expect(response.status).toBe(401);
    });

    it('should return 401 for /players without token', async () => {
      const orgId = '00000000-0000-0000-0000-000000000000';
      const response = await request(app.getHttpServer()).get(`/organizations/${orgId}/players`);

      expect(response.status).toBe(401);
    });

    it('should reject mock Bearer token when JWT validation is enabled', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', 'Bearer mock-jwt-token');

      expect(response.status).toBe(401);
    });
  });

  describe('Public Routes', () => {
    it('should allow access to /health without token', async () => {
      const response = await request(app.getHttpServer()).get('/health');

      // Health endpoint should be public
      expect([200, 404]).toContain(response.status);
    });
  });

  describe('JWT Validation', () => {
    it('should reject invalid token format', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', 'InvalidTokenFormat');

      expect(response.status).toBe(401);
    });

    it('should reject empty Authorization header', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', '');

      expect(response.status).toBe(401);
    });

    it('should reject missing Bearer prefix', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations')
        .set('Authorization', 'just-a-token');

      expect(response.status).toBe(401);
    });
  });
});
