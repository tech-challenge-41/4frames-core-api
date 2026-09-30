/** Termina um stream SSE aberto. Resolve quando os recursos dele (a conexão Redis dedicada) foram liberados. */
export type SseStreamCloser = () => Promise<void>;

/**
 * Streams SSE abertos nesta réplica. Um stream só termina num evento terminal ou quando o cliente sai, então
 * o `server.close()` esperaria por ele para sempre. No encerramento, `closeAll` termina cada um, e o
 * EventSource do navegador reconecta sozinho numa réplica que continua no ar.
 */
export class SseStreamRegistry {
  private readonly closers = new Set<SseStreamCloser>();
  private closing = false;

  public get size(): number {
    return this.closers.size;
  }

  /**
   * Registra um stream aberto e devolve a função que o tira do registro. Depois de `closeAll`, um stream novo
   * é fechado na hora: a réplica está saindo.
   */
  public register(close: SseStreamCloser): () => void {
    if (this.closing) {
      void close();
      return () => undefined;
    }

    this.closers.add(close);

    return () => {
      this.closers.delete(close);
    };
  }

  /** Fecha todos os streams abertos e os que abrirem depois. Devolve quantos estavam abertos. */
  public async closeAll(): Promise<number> {
    this.closing = true;

    const closers = [...this.closers];
    this.closers.clear();

    await Promise.allSettled(closers.map(close => close()));

    return closers.length;
  }
}
