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
  coveragePathIgnorePatterns: ['/node_modules/', '/src/generated/', 'index.ts$', 'src/env/load.ts']
};

export default config;
