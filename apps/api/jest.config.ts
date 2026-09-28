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
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/__tests__/**', '!src/**/__test__/**'],
  transformIgnorePatterns: ['node_modules/(?!(uuid)/)'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'src/infra/http/docs/',
    'src/dependencies/',
    'src/infra/http/http-initialize.ts',
    'src/infra/http/route/index.ts',
    'src/main.ts',
    'src/cron/main.ts',
    'src/types.d.ts'
  ],
  // Gate de cobertura do CI (sem SonarCloud). Subir conforme a cobertura crescer.
  coverageThreshold: {
    global: { statements: 76, branches: 62, functions: 74, lines: 76 }
  }
};

export default config;
