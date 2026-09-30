// Ponto de entrada leve: só módulos sem efeito colateral e sem dependências pesadas.
// Prisma, AWS e Redis ficam em subcaminhos para não abrir conexão nem carregar SDKs sem necessidade:
//   @4frames/shared/prisma · @4frames/shared/aws · @4frames/shared/redis
export * from './env';
export * from './health';
export * from './jobs';
export * from './logger';
export * from './process';
