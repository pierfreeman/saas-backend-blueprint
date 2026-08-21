import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Vitest config for worker-a-e2e integration tests.
 *
 * Runs serially (single fork) because tests share a single database
 * and the cleanDatabase() helper cannot run concurrently.
 * globalSetup runs Prisma migrations once before any test suite starts.
 */
export default defineConfig({
  resolve: {
    alias: [
      // Explicit aliases so forks-pool workers can resolve path aliases without
      // relying solely on vite-tsconfig-paths, which can fail for files outside root
      // (e.g. test/utils/*.ts, imported from apps/worker-a-e2e specs).
      {
        find: /^@libs\/([^/]+)\/([^/]+)$/,
        replacement: resolve(workspaceRoot, 'libs/$1/$2/src/index.ts'),
      },
      {
        find: /^@libs\/([^/]+)$/,
        replacement: resolve(workspaceRoot, 'libs/$1/src/index.ts'),
      },
      {
        find: /^@libs\/([^/]+)\/(.+)$/,
        replacement: resolve(workspaceRoot, 'libs/$1/src/$2'),
      },
      {
        find: /^@apps\/([^/]+)$/,
        replacement: resolve(workspaceRoot, 'apps/$1/src/index.ts'),
      },
      {
        find: /^@apps\/([^/]+)\/(.+)$/,
        replacement: resolve(workspaceRoot, 'apps/$1/src/$2'),
      },
      { find: /^@test\/(.+)$/, replacement: resolve(workspaceRoot, 'test/$1') },
    ],
  },
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
    include: ['apps/worker-a-e2e/src/**/*.integration.spec.ts'],
    // Run migrations once before all suites
    globalSetup: ['test/setup/global-setup.ts'],
    // Load .env.test in every worker before test files are imported
    setupFiles: ['test/setup/load-env.ts'],
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
      reportsDirectory: 'coverage/integration/apps/worker-a-e2e',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
