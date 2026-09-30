export interface IJobProgressReader {
  /**
   * Último percentual (0–100) que o worker gravou para cada job, na chave `progress:{jobId}`. Um job sem
   * progresso guardado fica fora do Map. O progresso é efêmero (ADR-001 §2.3): se o Redis falhar, a
   * implementação devolve um Map vazio em vez de rejeitar.
   */
  getMany(jobIds: string[]): Promise<Map<string, number>>;
}
