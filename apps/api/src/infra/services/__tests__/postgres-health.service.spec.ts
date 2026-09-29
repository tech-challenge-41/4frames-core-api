import { prisma } from '@4frames/shared/prisma';

import { PostgresHealthService } from '../postgres-health.service';

jest.mock('@4frames/shared/prisma', () => ({
  prisma: { $queryRaw: jest.fn() }
}));

describe('PostgresHealthService', () => {
  const mockQueryRaw = prisma.$queryRaw as unknown as jest.Mock;

  it('should be named database', () => {
    expect(new PostgresHealthService().name).toBe('database');
  });

  it('should run SELECT 1', async () => {
    mockQueryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(new PostgresHealthService().check()).resolves.toBeUndefined();

    const [strings] = mockQueryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(strings.join('')).toBe('SELECT 1');
  });

  it('should reject when the database does not answer', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'));

    await expect(new PostgresHealthService().check()).rejects.toThrow('connection refused');
  });
});
