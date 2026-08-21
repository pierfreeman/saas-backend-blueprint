import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    tsconfigPaths({
      root: join(dirname(fileURLToPath(import.meta.url)), '../../..'),
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
    name: 'admin-memberships',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: '../../../coverage/unit/libs/admin/memberships',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/**/*.module.ts',
        'src/**/*.dto.ts',
        'src/**/*.enum.ts',
        'src/**/*.entity.ts',
        'src/**/*.d.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
