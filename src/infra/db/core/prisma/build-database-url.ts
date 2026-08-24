import { env } from 'node:process';

/**
 * Monta a URL do Postgres para Prisma CLI e para o client com adapter `pg`.
 */
export function buildDatabaseUrl(): string {
  const directUrl = env.DATABASE_URL?.trim();

  if (directUrl) {
    return directUrl;
  }

  const USER = env.DB_USERNAME;
  const PASSWORD = env.DB_PASSWORD;
  const HOST = env.DB_HOST;
  const PORT = env.DB_PORT || '5432';
  const DATABASE = env.DB_DATABASE;
  const SCHEMA = env.DB_SCHEMA || 'public';
  const sslmode = env.DB_SSLMODE;

  const userEnc = USER ? encodeURIComponent(USER) : '';
  const passEnc = PASSWORD ? encodeURIComponent(PASSWORD) : '';

  const params = new URLSearchParams();
  params.set('schema', SCHEMA);

  if (sslmode) {
    params.set('sslmode', sslmode);
  }

  return `postgresql://${userEnc}:${passEnc}@${HOST}:${PORT}/${DATABASE}?${params.toString()}`;
}
