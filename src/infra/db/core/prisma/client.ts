import { PrismaPg } from '@prisma/adapter-pg';

import { buildDatabaseUrl } from './build-database-url';
import { PrismaClient } from './generated/client';

const adapter = new PrismaPg({ connectionString: buildDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

export { prisma };
