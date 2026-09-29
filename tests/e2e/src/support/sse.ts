import { config } from './config';

export interface JobEvent {
  type: string;
  jobId: string;
  percent?: number;
  frameCount?: number;
  reason?: string;
}

export interface JobEventStream {
  status: number;
  contentType: string | null;
  /** Eventos na ordem em que chegaram. */
  events: JobEvent[];
  /** Resolve quando o servidor fecha o stream (depois de job.done ou job.failed). */
  ended: Promise<void>;
  close(): void;
}

/**
 * Abre `GET /videos/:jobId/events?token=` como o EventSource do navegador, que não manda header, e lê os
 * eventos `data: <json>` à medida que chegam pelo Ingress.
 */
export async function openJobEvents(jobId: string, token: string): Promise<JobEventStream> {
  const controller = new AbortController();
  const response = await fetch(`${config.apiUrl}/videos/${jobId}/events?token=${encodeURIComponent(token)}`, {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal
  });
  const events: JobEvent[] = [];

  const read = async (): Promise<void> => {
    if (!response.body) {
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const messages = buffer.split('\n\n');
      buffer = messages.pop() ?? '';

      for (const message of messages) {
        if (message.startsWith('data: ')) {
          events.push(JSON.parse(message.slice('data: '.length)));
        }
      }
    }
  };

  const ended = read().catch((error: unknown) => {
    if (!controller.signal.aborted) {
      throw error;
    }
  });

  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    events,
    ended,
    close: () => controller.abort()
  };
}
