export type DependencyStatus = 'up' | 'down';

export interface CheckReadinessOutputDTO {
  /** Verdadeiro só quando todas as dependências responderam. */
  ready: boolean;
  /** Estado de cada dependência, pelo nome dela. */
  checks: Record<string, DependencyStatus>;
}
