export default {
  displayName: 'worker-a-e2e',
  preset: '../../jest.preset.js',
  globalSetup: '<rootDir>/../../test/setup/global-setup.ts',
  globalTeardown: '<rootDir>/../../test/setup/global-teardown.ts',
  setupFiles: ['<rootDir>/../../test/setup/load-env.ts'],
  testEnvironment: 'node',
  // ─── Run serially to avoid business DB truncation race conditions ───────────
  maxWorkers: 1,
  // ─── Integration tests are slower than unit tests ────────────────────────────
  testTimeout: 60000,
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/integration/worker-a-e2e',
  // ─── Only run integration test files ─────────────────────────────────────────
  testMatch: ['**/*.integration.spec.ts'],
};
