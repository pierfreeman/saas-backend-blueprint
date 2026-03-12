import * as path from 'node:path';
import * as fs from 'node:fs';
import { TemplateRenderer } from '../../lib/templates/template.renderer';

describe('TemplateRenderer', () => {
  const templateDir = path.join(
    __dirname,
    '../../lib/templates',
  );

  let renderer: TemplateRenderer;

  beforeEach(() => {
    renderer = new TemplateRenderer(templateDir);
  });

  describe('render', () => {
    it('renders user-invite template with all variables', () => {
      const html = renderer.render('user-invite', {
        inviterName: 'Alice',
        orgName: 'Acme Corp',
        inviteUrl: 'https://example.com/invite/abc',
        recipientName: 'Bob',
        expiresInDays: 7,
      });

      expect(html).toContain('Alice');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('https://example.com/invite/abc');
      expect(html).toContain('Bob');
      expect(html).toContain('7');
    });

    it('renders user-invite template without optional variables', () => {
      const html = renderer.render('user-invite', {
        inviterName: 'Alice',
        orgName: 'Acme Corp',
        inviteUrl: 'https://example.com/invite/abc',
      });

      expect(html).toContain('Alice');
      expect(html).toContain('Acme Corp');
      expect(html).not.toContain('Bob');
    });

    it('renders auth-login-link template with loginUrl', () => {
      const html = renderer.render('auth-login-link', {
        loginUrl: 'https://example.com/login?token=xyz',
        recipientName: 'Carol',
        expiresInMinutes: 15,
      });

      // Handlebars HTML-encodes special characters in double-brace expressions;
      // '=' becomes '&#x3D;' in href attributes (correct HTML encoding for email clients)
      expect(html).toContain('&#x3D;xyz');
      expect(html).toContain('Carol');
      expect(html).toContain('15');
    });

    it('renders export-ready template', () => {
      const html = renderer.render('export-ready', {
        exportName: 'Monthly Report',
        downloadUrl: 'https://example.com/exports/123',
        expiresInHours: 24,
      });

      expect(html).toContain('Monthly Report');
      expect(html).toContain('https://example.com/exports/123');
      expect(html).toContain('24');
    });

    it('renders system-alert template', () => {
      const html = renderer.render('system-alert', {
        alertType: 'CRITICAL',
        message: 'Database connection lost',
        orgName: 'Acme Corp',
        timestamp: '2026-01-01T00:00:00Z',
      });

      expect(html).toContain('CRITICAL');
      expect(html).toContain('Database connection lost');
      expect(html).toContain('Acme Corp');
      expect(html).toContain('2026-01-01T00:00:00Z');
    });

    it('HTML-escapes dangerous characters in template data', () => {
      const html = renderer.render('system-alert', {
        alertType: 'XSS Test',
        message: '<script>alert("xss")</script>',
      });

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('caches compiled templates (second render does not re-read file)', () => {
      const readFileSyncSpy = jest.spyOn(fs, 'readFileSync');

      renderer.render('user-invite', {
        inviterName: 'Alice',
        orgName: 'Acme',
        inviteUrl: 'https://example.com',
      });
      renderer.render('user-invite', {
        inviterName: 'Bob',
        orgName: 'Beta',
        inviteUrl: 'https://example.com',
      });

      // readFileSync should have been called only once for the same template
      const callsForTemplate = readFileSyncSpy.mock.calls.filter((args) =>
        String(args[0]).includes('user-invite'),
      );
      expect(callsForTemplate.length).toBe(1);

      readFileSyncSpy.mockRestore();
    });

    it('throws when the template file does not exist', () => {
      expect(() => renderer.render('non-existent-template', {})).toThrow(
        /not found/,
      );
    });
  });
});
