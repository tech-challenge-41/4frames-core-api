import { mergePaths } from '../merge-paths';

describe('mergePaths', () => {
  it('should keep both operations when two groups share a path', () => {
    const create = { '/videos': { post: { summary: 'criar' } } };
    const list = { '/videos': { get: { summary: 'listar' } } };

    expect(mergePaths(create, list)).toEqual({
      '/videos': { post: { summary: 'criar' }, get: { summary: 'listar' } }
    });
  });

  it('should keep paths that appear in a single group', () => {
    const merged = mergePaths({ '/ready': { get: {} } }, { '/auth': { post: {} } });

    expect(Object.keys(merged)).toEqual(['/ready', '/auth']);
  });

  it('should fail when the same operation is defined twice', () => {
    expect(() =>
      mergePaths({ '/videos': { get: { summary: 'a' } } }, { '/videos': { get: { summary: 'b' } } })
    ).toThrow('OpenAPI: "get" em /videos está definido mais de uma vez');
  });
});
