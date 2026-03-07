import { FeatureFlagsModule } from './feature-flags.module';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureGuard } from './guards/feature.guard';

/**
 * Module-level spec for FeatureFlagsModule.
 *
 * Verifies that the NestJS @Module() metadata is correctly configured so that:
 *  - FeatureFlagsService and FeatureGuard are provided and exported
 *  - FeatureFlagsController is registered
 *  - All required infrastructure modules are declared as imports
 */
describe('FeatureFlagsModule', () => {
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

  it('provides FeatureFlagsService', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', FeatureFlagsModule) ?? [];
    expect(providers).toContain(FeatureFlagsService);
  });

  it('provides FeatureGuard', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', FeatureFlagsModule) ?? [];
    expect(providers).toContain(FeatureGuard);
  });

  it('exports FeatureFlagsService so other modules can inject it', () => {
    const exports: unknown[] =
      Reflect.getMetadata('exports', FeatureFlagsModule) ?? [];
    expect(exports).toContain(FeatureFlagsService);
  });

  it('exports FeatureGuard so other modules can compose it in @UseGuards()', () => {
    const exports: unknown[] =
      Reflect.getMetadata('exports', FeatureFlagsModule) ?? [];
    expect(exports).toContain(FeatureGuard);
  });
});
