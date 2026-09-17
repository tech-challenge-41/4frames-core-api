import { defineConfig } from 'prisma/config';

import { loadEnv } from './src/env';
import { buildDatabaseUrl } from './src/prisma/build-database-url';

// O .env fica na raiz do monorepo; o Prisma CLI roda com cwd em packages/shared.
loadEnv();

export default defineConfig({
  schema: 'prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seeds/seed.ts'
  },
  datasource: {
    url: buildDatabaseUrl()
  }
});
