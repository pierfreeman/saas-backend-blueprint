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
    name: 'email',
    globals: true,
    environment: 'node',
    // Exclude integration specs — those run in the e2e job via CI
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    exclude: ['**/*.integration.spec.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/unit/libs/email',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
