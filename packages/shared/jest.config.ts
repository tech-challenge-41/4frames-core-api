import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  maxWorkers: process.env.JEST_MAX_WORKERS ?? '50%',
  testMatch: ['**/*.spec.ts'],
  clearMocks: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/**/__tests__/**', '!src/generated/**'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/src/generated/',
    'index.ts$',
    'src/env/load.ts',
    // Bootstrap OTEL (efeito colateral + SDK); coberto por smoke local com o Agent.
    'src/monitoring/otel.ts',
    'src/monitoring/load.ts'
  ],
  // Gate de cobertura do CI (sem SonarCloud). Subir conforme a cobertura crescer.
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 }
  }
};

export default config;
