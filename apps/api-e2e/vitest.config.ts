import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

/**
 * Vitest config for api-e2e integration tests.
 *
 * Runs serially (single fork) because tests share a single database
 * and the cleanDatabase() helper cannot run concurrently.
 * globalSetup runs Prisma migrations once before any test suite starts.
 */
export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: join(dirname(fileURLToPath(import.meta.url)), '../..'),
    }),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
      module: { type: 'es6' },
    }),
  ],
  test: {
    name: 'api-e2e',
    globals: true,
    environment: 'node',
    // Only pick up integration spec files (not unit tests)
    include: ['src/**/*.integration.spec.ts'],
    // Run migrations once before all suites
    globalSetup: ['../../test/setup/global-setup.ts'],
    // Load .env.test in every worker before test files are imported
    setupFiles: ['../../test/setup/load-env.ts'],
    // Integration tests are significantly slower than unit tests
    testTimeout: 60000,
    hookTimeout: 60000,
    // Single worker: cleanDatabase + shared DB cannot run in parallel
    // (replaces Vitest 3's poolOptions.forks.singleFork which was removed in Vitest 4)
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/integration/apps/api-e2e',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
