import 'dotenv/config';
import path from 'node:path';

import { defineConfig } from 'prisma/config';

import { buildDatabaseUrl } from './src/infra/db/core/prisma/build-database-url';

const DATABASE_URL = buildDatabaseUrl();

export default defineConfig({
  schema: path.join('src/infra/db/core/prisma'),
  migrations: {
    path: 'src/infra/db/core/prisma/migrations',
    seed: 'tsx src/infra/db/core/prisma/seeds/seed.ts'
  },
  datasource: {
    url: DATABASE_URL
  }
});
