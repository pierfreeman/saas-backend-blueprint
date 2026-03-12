module.exports = {
  displayName: 'email',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/email',
  moduleNameMapper: {
    '^@saas-backend/activity-log$': '<rootDir>/../../libs/activity-log/src/index.ts',
    '^@saas-backend/legal-audit$': '<rootDir>/../../libs/legal-audit/src/index.ts',
    '^@saas-backend/events$': '<rootDir>/../../libs/events/src/index.ts',
  },
};

