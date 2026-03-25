import { FeatureFlagsModule } from './feature-flags.module';
import {
  FeatureFlagsModule as FeatureFlagsLibModule,
  FeatureFlagsService,
  FeatureGuard,
} from '@libs/feature-flags';
import { RBACModule } from '@libs/rbac';
import { FeatureFlagsController } from './feature-flags.controller';

/**
 * Module-level spec for the app-layer FeatureFlagsModule (thin Pattern F module).
 *
 * The app module is a thin orchestration layer that:
 *  - Imports FeatureFlagsLibModule (which provides and exports FeatureFlagsService + FeatureGuard)
 *  - Registers FeatureFlagsController
 *
 * Business logic (service, guard) is tested in @libs/feature-flags.
 */
describe('FeatureFlagsModule (app layer)', () => {
  it('is defined as a class', () => {
    expect(FeatureFlagsModule).toBeDefined();
    expect(typeof FeatureFlagsModule).toBe('function');
  });

  it('can be instantiated without errors', () => {
    expect(() => new FeatureFlagsModule()).not.toThrow();
  });

  it('registers FeatureFlagsController', () => {
    const controllers: unknown[] =
      Reflect.getMetadata('controllers', FeatureFlagsModule) ?? [];
    expect(controllers).toContain(FeatureFlagsController);
  });

  it('imports FeatureFlagsLibModule to obtain FeatureFlagsService and FeatureGuard', () => {
    const imports: unknown[] =
      Reflect.getMetadata('imports', FeatureFlagsModule) ?? [];
    expect(imports).toContain(FeatureFlagsLibModule);
  });

  it('imports RBACModule to provide OrgContextGuard to the controller', () => {
    const imports: unknown[] =
      Reflect.getMetadata('imports', FeatureFlagsModule) ?? [];
    expect(imports).toContain(RBACModule);
  });
});

/**
 * Module-level spec for the lib FeatureFlagsModule.
 */
describe('FeatureFlagsLibModule (lib layer)', () => {
  it('provides FeatureFlagsService', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', FeatureFlagsLibModule) ?? [];
    expect(providers).toContain(FeatureFlagsService);
  });

  it('provides FeatureGuard', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', FeatureFlagsLibModule) ?? [];
    expect(providers).toContain(FeatureGuard);
  });

  it('exports FeatureFlagsService so other modules can inject it', () => {
    const exports: unknown[] =
      Reflect.getMetadata('exports', FeatureFlagsLibModule) ?? [];
    expect(exports).toContain(FeatureFlagsService);
  });

  it('exports FeatureGuard so other modules can compose it in @UseGuards()', () => {
    const exports: unknown[] =
      Reflect.getMetadata('exports', FeatureFlagsLibModule) ?? [];
    expect(exports).toContain(FeatureGuard);
  });
});
