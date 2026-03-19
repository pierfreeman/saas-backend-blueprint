import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            // Libs can only import from other libs — never from apps.
            {
              sourceTag: 'type:lib',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            // Apps can only import from libs, not from other apps.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
            // E2e test suites may depend on libs, the app under test, and shared test utilities.
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: [
                'type:lib',
                'type:app',
                'type:test-utils',
              ],
            },
            // Shared test utilities may only depend on libs.
            {
              sourceTag: 'type:test-utils',
              onlyDependOnLibsWithTags: ['type:lib'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  // ── Phase 5: Enforce repository pattern ─────────────────────────────────────
  // Prevent raw Prisma service imports outside infrastructure/repositories.
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@libs/prisma-business',
              importNames: ['PrismaBusinessService'],
              message:
                'PrismaBusinessService must only be used inside infrastructure/repositories/**. Inject a repository instead.',
            },
            {
              name: '@libs/prisma-legal',
              importNames: ['PrismaLegalService'],
              message:
                'PrismaLegalService must only be used inside infrastructure/repositories/**. Use LegalAuditRepository instead.',
            },
          ],
        },
      ],
    },
  },
  // Approved locations where direct Prisma service access is acceptable.
  {
    files: [
      '**/infrastructure/repositories/**/*.ts',
      'libs/prisma-business/src/**/*.ts',
      'libs/prisma-legal/src/**/*.ts',
      'libs/activity-log/src/**/*.ts',
      'libs/legal-audit/src/**/*.ts',
      'test/**/*.ts',
      'apps/api-e2e/**/*.ts',
      'apps/worker-a-e2e/**/*.ts',
      '**/*.spec.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
];
