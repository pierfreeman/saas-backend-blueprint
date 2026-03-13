export default {
  displayName: 'api-e2e',
  preset: '../../jest.preset.js',
  // ─── Use shared test setup that runs migrations against test containers ───────
  globalSetup: '<rootDir>/../../test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/../../test/setup/global-teardown.ts',
  // ─── Load .env.test before any test module is imported ───────────────────────
  setupFiles: ['<rootDir>/../../test/setup/load-env.ts'],
  testEnvironment: 'node',
  // ─── Run serially: cleanDatabase() + single shared DB cannot run in parallel ─
  maxWorkers: 1,
  // ─── Integration tests are significantly slower than unit tests ──────────────
  testTimeout: 60000,
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  // ─── Allow Jest to transform jose (pure ESM) so it runs under CJS/Jest ───────
  transformIgnorePatterns: ['node_modules/(?!(jose|uuid)/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/integration/apps/api-e2e',
  // ─── Only pick up integration spec files (not unit tests) ────────────────────
  testMatch: ['**/*.integration.spec.ts'],
};
