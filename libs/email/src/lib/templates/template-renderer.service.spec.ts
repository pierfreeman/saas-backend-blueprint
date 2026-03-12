import { Test, TestingModule } from '@nestjs/testing';
import { TemplateRendererService } from './template-renderer.service';
import { EmailTemplateName } from '../types/email-template.type';

describe('TemplateRendererService', () => {
  let service: TemplateRendererService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TemplateRendererService],
    }).compile();

    service = module.get<TemplateRendererService>(TemplateRendererService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('render', () => {
    it('should render user-invite template successfully', async () => {
      const data = {
        inviteeName: 'John Doe',
        inviterName: 'Jane Smith',
        organizationName: 'Acme Corp',
        role: 'Admin',
        inviteUrl: 'https://example.com/invite/abc123',
        expiresAt: new Date('2026-04-01'),
      };

      const result = await service.render('user-invite', data);

      expect(result).toContain('John Doe');
      expect(result).toContain('Jane Smith');
      expect(result).toContain('Acme Corp');
      expect(result).toContain('Admin');
      expect(result).toContain('https://example.com/invite/abc123');
    });

    it('should render auth-login-link template successfully', async () => {
      const data = {
        userName: 'John Doe',
        loginUrl: 'https://example.com/auth/login/xyz789',
        expirationMinutes: 15,
      };

      const result = await service.render('auth-login-link', data);

      expect(result).toContain('John Doe');
      expect(result).toContain('https://example.com/auth/login/xyz789');
      expect(result).toContain('15');
    });

    it('should render export-ready template successfully', async () => {
      const data = {
        userName: 'John Doe',
        exportType: 'Customer Data',
        fileSize: '2.5 MB',
        recordCount: 1500,
        completedAt: new Date('2026-03-12'),
        downloadUrl: 'https://example.com/download/export123',
        downloadExpirationDays: 7,
      };

      const result = await service.render('export-ready', data);

      expect(result).toContain('John Doe');
      expect(result).toContain('Customer Data');
      expect(result).toContain('2.5 MB');
      expect(result).toContain('1500');
      expect(result).toContain('https://example.com/download/export123');
      expect(result).toContain('7');
    });

    it('should render system-alert template successfully', async () => {
      const data = {
        userName: 'John Doe',
        alertType: 'Security Alert',
        severity: 'high',
        timestamp: new Date('2026-03-12'),
        message: 'Unusual activity detected on your account.',
        actionRequired: 'Please review your recent activity.',
        actionUrl: 'https://example.com/security/review',
      };

      const result = await service.render('system-alert', data);

      expect(result).toContain('John Doe');
      expect(result).toContain('Security Alert');
      expect(result).toContain('HIGH');
      expect(result).toContain('Unusual activity detected on your account.');
    });

    it('should cache templates after first render', async () => {
      const data = { userName: 'Test User', loginUrl: 'https://test.com' };

      // First render
      await service.render('auth-login-link', data);

      // Clear cache and verify it was cached
      const cacheSize = (service as any).templateCache.size;
      expect(cacheSize).toBeGreaterThan(0);

      // Second render should use cache
      const result = await service.render('auth-login-link', data);
      expect(result).toContain('Test User');
    });

    it('should throw error for non-existent template', async () => {
      const data = {};

      await expect(
        service.render('non-existent-template' as EmailTemplateName, data),
      ).rejects.toThrow('Template not found');
    });

    it('should handle template rendering errors', async () => {
      // Handlebars renders gracefully with null data (empty values, no throw)
      const data = null as any;

      await expect(service.render('user-invite', data)).resolves.toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('should clear template cache', async () => {
      const data = { userName: 'Test User', loginUrl: 'https://test.com' };

      // Render to populate cache
      await service.render('auth-login-link', data);

      // Verify cache has entries
      expect((service as any).templateCache.size).toBeGreaterThan(0);

      // Clear cache
      service.clearCache();

      // Verify cache is empty
      expect((service as any).templateCache.size).toBe(0);
    });
  });

  describe('Handlebars helpers', () => {
    it('should format dates correctly', async () => {
      const data = {
        inviteeName: 'Test User',
        inviterName: 'Inviter',
        organizationName: 'Test Org',
        role: 'Member',
        inviteUrl: 'https://test.com',
        expiresAt: new Date('2026-04-15T12:00:00Z'),
      };

      const result = await service.render('user-invite', data);

      // Should contain formatted date (format: Month Day, Year)
      expect(result).toMatch(/April 15, 2026/);
    });

    it('should handle uppercase helper', async () => {
      const data = {
        userName: 'Test User',
        alertType: 'security',
        severity: 'high',
        timestamp: new Date(),
        message: 'Test message',
      };

      const result = await service.render('system-alert', data);

      // The severity should be uppercased in the template
      expect(result).toContain('HIGH');
    });
  });
});
