import { TenantModule } from './tenant.module';
import { TenantContextService } from './tenant-context.service';

/**
 * TenantModule is a pure NestJS metadata class with no runtime logic.
 * Importing it and verifying the class shape is enough to achieve full
 * statement coverage of tenant.module.ts.
 */
describe('TenantModule', () => {
  it('is defined as a class', () => {
    expect(TenantModule).toBeDefined();
    expect(typeof TenantModule).toBe('function');
  });

  it('can be instantiated without errors', () => {
    expect(() => new TenantModule()).not.toThrow();
  });

  it('is decorated with @Module metadata that provides TenantContextService', () => {
    // NestJS stores module metadata under the MODULE_METADATA key
    const providers: unknown[] =
      Reflect.getMetadata('providers', TenantModule) ?? [];
    expect(providers).toContain(TenantContextService);
  });

  it('exports TenantContextService so feature modules can inject it', () => {
    const exports: unknown[] =
      Reflect.getMetadata('exports', TenantModule) ?? [];
    expect(exports).toContain(TenantContextService);
  });
});
