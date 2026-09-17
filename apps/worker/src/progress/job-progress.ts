/**
 * Percentual do job publicado no Redis. A extração com ffmpeg ocupa a maior parte da faixa;
 * 100 só é gravado junto com o evento job.done.
 */
export const PROGRESS = {
  probed: 5,
  extractionStart: 5,
  extractionEnd: 85,
  zipped: 90,
  uploaded: 99
} as const;

export function clampPercent(percent: number): number {
  if (Number.isNaN(percent)) {
    return 0;
  }

  return Math.min(100, Math.max(0, percent));
}

/** Converte a fração processada pelo ffmpeg (0–1) no percentual do job. */
export function extractionPercent(ratio: number): number {
  const safeRatio = Math.min(1, Math.max(0, Number.isNaN(ratio) ? 0 : ratio));

  return PROGRESS.extractionStart + (PROGRESS.extractionEnd - PROGRESS.extractionStart) * safeRatio;
}

export interface ProgressThrottleOptions {
  minIntervalMs?: number;
  now?: () => number;
}

/**
 * Limita as publicações de progresso: no máximo uma por ponto percentual inteiro e uma por intervalo
 * (1 s por padrão). Nunca publica um valor menor ou igual ao último.
 */
export class ProgressThrottle {
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private lastPercent = -1;
  private lastPublishedAt = Number.NEGATIVE_INFINITY;

  constructor({ minIntervalMs = 1000, now = Date.now }: ProgressThrottleOptions = {}) {
    this.minIntervalMs = minIntervalMs;
    this.now = now;
  }

  /** Devolve o percentual inteiro a publicar, ou `undefined` se esta atualização deve ser descartada. */
  public next(percent: number): number | undefined {
    const value = Math.floor(clampPercent(percent));
    const at = this.now();

    if (value <= this.lastPercent || at - this.lastPublishedAt < this.minIntervalMs) {
      return undefined;
    }

    this.lastPercent = value;
    this.lastPublishedAt = at;

    return value;
  }
}
