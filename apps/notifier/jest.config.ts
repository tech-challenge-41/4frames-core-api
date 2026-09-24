import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: process.env.JEST_MAX_WORKERS ?? '50%',
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@4frames/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@4frames/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1'
  },
  clearMocks: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/__tests__/**', '!src/main.ts'],
  // Scaffold sem testes ainda: coverageThreshold entra quando houver código cobrível além do main.
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: ['src/infra/notifications/email/templates/.*\\.pug']
};

export default config;
