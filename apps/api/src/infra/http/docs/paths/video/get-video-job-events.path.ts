/**
 * SSE não se encaixa bem no formato request/response padrão do OpenAPI (não há um "response body"
 * único, e sim um stream de eventos `data: ...\n\n`). Esta entrada documenta o contrato de forma
 * simplificada: content-type, autenticação (nota sobre o token via query) e o formato de cada evento.
 */
export const getVideoJobEventsPath = {
  '/videos/{jobId}/events': {
    get: {
      tags: ['video'],
      summary: 'Acompanhar o progresso de um job de vídeo em tempo real (Server-Sent Events)',
      description:
        'Abre um stream SSE (text/event-stream) com os eventos de progresso do job, retransmitidos do ' +
        'Redis Pub/Sub (job:{jobId}). Ao conectar, emite imediatamente um evento job.progress com o ' +
        'último percentual conhecido (se houver). A conexão é fechada pelo servidor após um evento ' +
        'terminal (job.done ou job.failed); comentários `: heartbeat` são enviados a cada ~15s para ' +
        'evitar que proxies/load balancers derrubem a conexão por inatividade. Entrega é at-most-once ' +
        '(ADR-001 §4.2) — sem persistência de eventos perdidos; GET /videos/{jobId} continua sendo o ' +
        'fallback por polling se o stream cair (o EventSource do navegador reconecta sozinho, mas perde ' +
        'o que aconteceu enquanto estava desconectado).\n\n' +
        '**Autenticação**: o EventSource nativo do navegador não permite headers customizados, então ' +
        'esta rota (só esta) também aceita o token via `?token=`, além do header Authorization padrão ' +
        '(usado por curl/testes manuais). Um token na query string pode vazar em logs de acesso e ' +
        'proxies intermediários — avaliar esse risco antes de expor a rota atrás de um proxy que logue ' +
        'a URL completa.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'jobId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Identificador do job (UUID)'
        },
        {
          name: 'token',
          in: 'query',
          required: false,
          schema: { type: 'string' },
          description: 'JWT de acesso, alternativa ao header Authorization (necessário para EventSource no navegador)'
        }
      ],
      responses: {
        200: {
          description:
            'Stream SSE aberto. Cada mensagem é `data: <JSON>\\n\\n`, onde o JSON é um dos três formatos abaixo.',
          content: {
            'text/event-stream': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    title: 'job.progress',
                    properties: {
                      type: { type: 'string', enum: ['job.progress'] },
                      jobId: { type: 'string', format: 'uuid' },
                      userId: { type: 'number' },
                      percent: { type: 'number', minimum: 0, maximum: 100 }
                    }
                  },
                  {
                    type: 'object',
                    title: 'job.done',
                    properties: {
                      type: { type: 'string', enum: ['job.done'] },
                      jobId: { type: 'string', format: 'uuid' },
                      userId: { type: 'number' },
                      zipKey: { type: 'string' },
                      frameCount: { type: 'integer' }
                    }
                  },
                  {
                    type: 'object',
                    title: 'job.failed',
                    properties: {
                      type: { type: 'string', enum: ['job.failed'] },
                      jobId: { type: 'string', format: 'uuid' },
                      userId: { type: 'number' },
                      reason: { type: 'string' }
                    }
                  }
                ]
              }
            }
          }
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' }
      }
    }
  }
};
