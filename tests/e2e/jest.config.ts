import type { Config } from 'jest';

// Não entra no `pnpm test`: precisa da stack no ar (./scripts/k8s-local.sh up). Rode com `pnpm test:e2e`.
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  // Um vídeo de 30 s leva segundos para processar, mas o worker pode estar escalando do zero.
  testTimeout: 5 * 60_000,
  // Os cenários compartilham os jobs criados e rodam em ordem, contra um cluster só.
  maxWorkers: 1
};

export default config;
