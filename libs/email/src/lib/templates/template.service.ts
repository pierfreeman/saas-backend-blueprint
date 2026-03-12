import { Injectable } from '@nestjs/common';
import * as path from 'node:path';
import { TemplateRenderer } from './template.renderer';
import type {
  EmailTemplateName,
  EmailTemplateData,
} from '../types/email-template.type';

/**
 * TemplateService
 *
 * NestJS service wrapper around TemplateRenderer.
 * Provides template rendering as an injectable dependency.
 *
 * In both source (ts-jest) and compiled (dist) contexts, `__dirname` resolves
 * to the directory that contains this file, which is the same directory where
 * the `.hbs` template files are located (`templates/`).
 */
@Injectable()
export class TemplateService {
  private readonly renderer: TemplateRenderer;

  constructor() {
    const templateDir = path.join(__dirname);
    this.renderer = new TemplateRenderer(templateDir);
  }

  /**
   * Renders a named Handlebars template with the provided data.
   * Returns an HTML string safe for use as an email body.
   */
  render(
    templateName: EmailTemplateName | string,
    data: EmailTemplateData | Record<string, unknown>,
  ): string {
    return this.renderer.render(templateName, data as Record<string, unknown>);
  }
}
