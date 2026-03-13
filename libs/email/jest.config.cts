module.exports = {
  displayName: 'email',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['\\.integration\\.spec\\.ts$'],
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/unit/libs/email',
  moduleNameMapper: {
    '^@libs/activity-log$': '<rootDir>/../../libs/activity-log/src/index.ts',
    '^@libs/legal-audit$': '<rootDir>/../../libs/legal-audit/src/index.ts',
    '^@libs/events$': '<rootDir>/../../libs/events/src/index.ts',
  },
};
