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
    name: 'redis',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../coverage/unit/libs/redis',
      reporter: ['text', 'lcov', 'html'],
    },
  },
});
