/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        strict: false,
        noUnusedLocals: false,
        noUnusedParameters: false,
      },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterFramework: [],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  collectCoverageFrom: [
    'src/modules/**/*.ts',
    'src/common/**/*.ts',
    'src/infrastructure/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/types.ts',
    '!src/**/index.ts',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 30000,
  globals: {},
};

export default config;
