import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Handlebars from 'handlebars';
import type { EmailTemplateName } from '../types/email-template.type';

/**
 * TemplateRenderer
 *
 * Utility class responsible for loading and compiling Handlebars templates.
 * Templates live in the same directory as this file (`templates/*.hbs`).
 *
 * Responsibilities:
 *   - Load `.hbs` template files from disk (lazy-loaded on first use, then cached).
 *   - Compile templates with Handlebars (safe HTML escaping by default).
 *   - Inject dynamic data and return the rendered HTML string.
 *
 * Usage:
 *   const renderer = new TemplateRenderer();
 *   const html = renderer.render('user-invite', { inviterName: 'Alice', ... });
 */
export class TemplateRenderer {
  private readonly templateDir: string;
  private readonly cache = new Map<string, HandlebarsTemplateDelegate>();

  constructor(templateDir?: string) {
    this.templateDir = templateDir ?? path.join(__dirname);
  }

  /**
   * Renders a named template with the provided data.
   * Returns an HTML string.
   *
   * @param templateName  Name of the `.hbs` file (without extension).
   * @param data          Variables injected into the template.
   */
  render(
    templateName: EmailTemplateName | string,
    data: Record<string, unknown>,
  ): string {
    const compiled = this.getCompiled(templateName);
    return compiled(data);
  }

  /** Loads and caches a compiled Handlebars template. */
  private getCompiled(name: string): HandlebarsTemplateDelegate {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const filePath = path.join(this.templateDir, `${name}.hbs`);

    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Email template "${name}" not found at path: ${filePath}`,
      );
    }

    const source = fs.readFileSync(filePath, 'utf8');
    const compiled = Handlebars.compile(source);
    this.cache.set(name, compiled);
    return compiled;
  }
}

// Handlebars template delegate type helper
type HandlebarsTemplateDelegate = ReturnType<typeof Handlebars.compile>;
