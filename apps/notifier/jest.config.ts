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
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: ['src/infra/notifications/email/templates/.*\\.pug'],
  // Gate de cobertura do CI (sem SonarCloud). Subir conforme a cobertura crescer.
  coverageThreshold: {
    global: { statements: 98, branches: 79, functions: 98, lines: 98 }
  }
};

export default config;
