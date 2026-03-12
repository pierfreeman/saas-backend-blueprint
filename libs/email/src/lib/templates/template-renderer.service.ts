import { Injectable, Logger } from '@nestjs/common';
import * as Handlebars from 'handlebars';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  EmailTemplateName,
  EmailTemplateData,
} from '../types/email-template.type';

/**
 * Template Renderer Service
 *
 * Loads and compiles Handlebars templates for email generation.
 * Templates are located in libs/email/src/lib/templates/*.hbs
 */
@Injectable()
export class TemplateRendererService {
  private readonly logger = new Logger(TemplateRendererService.name);
  private readonly templateCache: Map<string, Handlebars.TemplateDelegate> =
    new Map();
  private readonly templatesDir: string;

  constructor() {
    // Templates directory is in the same directory as this service file
    // During tests, templates are at libs/email/src/lib/templates/*.hbs
    // In compiled output, they should be copied to dist
    this.templatesDir = __dirname;

    // Register Handlebars helpers
    this.registerHelpers();

    this.logger.log(`Template directory: ${this.templatesDir}`);
  }

  /**
   * Register custom Handlebars helpers
   */
  private registerHelpers(): void {
    // Date formatting helper
    Handlebars.registerHelper('formatDate', (date: Date) => {
      if (!date) return '';
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    });

    // Conditional helper for equality
    Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);

    // Uppercase helper
    Handlebars.registerHelper('uppercase', (str: string) =>
      str ? str.toUpperCase() : '',
    );
  }

  /**
   * Render a template with the given data
   *
   * @param templateName Name of the template (without .hbs extension)
   * @param data Data to inject into the template
   * @returns Rendered HTML string
   */
  async render(
    templateName: EmailTemplateName,
    data: EmailTemplateData,
  ): Promise<string> {
    try {
      const template = await this.getTemplate(templateName);
      const rendered = template(data);

      this.logger.debug(`Rendered template: ${templateName}`);

      return rendered;
    } catch (error) {
      this.logger.error(
        `Failed to render template ${templateName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(
        `Template rendering failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get a compiled template (from cache or file system)
   */
  private async getTemplate(
    templateName: string,
  ): Promise<Handlebars.TemplateDelegate> {
    // Check cache first
    if (this.templateCache.has(templateName)) {
      return this.templateCache.get(templateName)!;
    }

    // Load from file system
    const templatePath = path.join(this.templatesDir, `${templateName}.hbs`);

    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templateName}.hbs`);
    }

    const templateSource = fs.readFileSync(templatePath, 'utf-8');
    const compiled = Handlebars.compile(templateSource);

    // Cache for future use
    this.templateCache.set(templateName, compiled);

    return compiled;
  }

  /**
   * Clear template cache (useful for testing or hot reload)
   */
  clearCache(): void {
    this.templateCache.clear();
    this.logger.log('Template cache cleared');
  }
}
