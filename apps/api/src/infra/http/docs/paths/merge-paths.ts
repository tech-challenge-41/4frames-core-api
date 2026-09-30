type PathItem = Record<string, unknown>;

export type OpenApiPaths = Record<string, PathItem>;

/**
 * Junta os objetos de paths do OpenAPI. Duas operações no mesmo caminho (ex.: POST e GET em /videos) ficam
 * lado a lado, em vez de o espalhamento do segundo objeto apagar o primeiro. A mesma operação definida duas
 * vezes é erro: uma das duas sumiria do Swagger sem aviso.
 */
export function mergePaths(...groups: OpenApiPaths[]): OpenApiPaths {
  const merged: OpenApiPaths = {};

  for (const group of groups) {
    for (const [path, item] of Object.entries(group)) {
      const current = merged[path] ?? {};
      const repeated = Object.keys(item).find(key => key in current);

      if (repeated) {
        throw new Error(`OpenAPI: "${repeated}" em ${path} está definido mais de uma vez`);
      }

      merged[path] = { ...current, ...item };
    }
  }

  return merged;
}
