import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

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
    name: 'observability',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    // Integration specs have their own CI job and are excluded here
    exclude: ['**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/unit/libs/observability',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
