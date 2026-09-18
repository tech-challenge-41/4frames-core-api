/**
 * Executa `task` para cada item com no máximo `concurrency` execuções ao mesmo tempo.
 * Na primeira falha, não inicia novos itens e rejeita com o erro depois que os já iniciados terminam.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  let failure: { error: unknown } | undefined;

  const runLane = async () => {
    while (failure === undefined && nextIndex < items.length) {
      const item = items[nextIndex++] as T;

      try {
        await task(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  };

  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, runLane);
  await Promise.all(lanes);

  if (failure !== undefined) {
    throw failure.error;
  }
}
