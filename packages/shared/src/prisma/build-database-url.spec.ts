import { buildDatabaseUrl } from './build-database-url';

describe('buildDatabaseUrl', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of [
      'DATABASE_URL',
      'DB_USERNAME',
      'DB_PASSWORD',
      'DB_HOST',
      'DB_PORT',
      'DB_DATABASE',
      'DB_SCHEMA',
      'DB_SSLMODE'
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should prefer DATABASE_URL when it is set', () => {
    process.env.DATABASE_URL = '  postgresql://u:p@db:5432/x  ';
    process.env.DB_HOST = 'ignored';

    expect(buildDatabaseUrl()).toBe('postgresql://u:p@db:5432/x');
  });

  it('should build the URL from DB_* variables, encoding credentials', () => {
    Object.assign(process.env, {
      DB_USERNAME: 'admin',
      DB_PASSWORD: 'p@ss:word',
      DB_HOST: 'postgres',
      DB_PORT: '5433',
      DB_DATABASE: '4frames_core',
      DB_SCHEMA: 'app',
      DB_SSLMODE: 'disable'
    });

    expect(buildDatabaseUrl()).toBe(
      'postgresql://admin:p%40ss%3Aword@postgres:5433/4frames_core?schema=app&sslmode=disable'
    );
  });

  it('should default the port and schema and omit sslmode', () => {
    Object.assign(process.env, { DB_USERNAME: 'a', DB_PASSWORD: 'b', DB_HOST: 'localhost', DB_DATABASE: 'db' });

    expect(buildDatabaseUrl()).toBe('postgresql://a:b@localhost:5432/db?schema=public');
  });
});
