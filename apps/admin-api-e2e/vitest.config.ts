import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Vitest config for admin-api-e2e integration tests.
 *
 * Runs serially (single fork) because tests share a single database
 * and the cleanDatabase() helper cannot run concurrently.
 * globalSetup runs Prisma migrations once before any test suite starts.
 */
export default defineConfig({
  resolve: {
    alias: [
      // Nested lib packages: @libs/admin/auth → libs/admin/auth/src/index.ts
      {
        find: /^@libs\/([^/]+)\/([^/]+)$/,
        replacement: resolve(workspaceRoot, 'libs/$1/$2/src/index.ts'),
      },
      // Top-level lib packages: @libs/activity-log → libs/activity-log/src/index.ts
      {
        find: /^@libs\/([^/]+)$/,
        replacement: resolve(workspaceRoot, 'libs/$1/src/index.ts'),
      },
      // Sub-path in top-level lib: @libs/activity-log/services/foo
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
    root: dirname(fileURLToPath(import.meta.url)),
    name: 'admin-api-e2e',
    globals: true,
    environment: 'node',
    include: ['src/**/*.integration.spec.ts'],
    globalSetup: [resolve(workspaceRoot, 'test/setup/global-setup.ts')],
    setupFiles: [resolve(workspaceRoot, 'test/setup/load-env.ts')],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    maxWorkers: 1,
    isolate: false,
    coverage: {
      provider: 'v8',
      reportsDirectory: resolve(
        workspaceRoot,
        'coverage/integration/apps/admin-api-e2e',
      ),
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
