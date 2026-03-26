import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

/**
 * Vitest config for worker-a-e2e integration tests.
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
    name: 'worker-a-e2e',
    globals: true,
    environment: 'node',
    // Only pick up integration spec files
    include: ['src/**/*.integration.spec.ts'],
    // Run migrations once before all suites
    globalSetup: ['../../test/setup/global-setup.ts'],
    // Load .env.test in every worker before test files are imported
    setupFiles: ['../../test/setup/load-env.ts'],
    // Integration tests are slower than unit tests
    testTimeout: 60000,
    hookTimeout: 60000,
    // Serial: business DB truncation cannot run in parallel
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/integration/apps/worker-a-e2e',
      reporter: ['lcov', 'html'],
    },
  },
});
