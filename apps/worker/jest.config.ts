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
  // Gate de cobertura do Card 5 (sem SonarCloud). Subir conforme a cobertura crescer.
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 }
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};

export default config;
