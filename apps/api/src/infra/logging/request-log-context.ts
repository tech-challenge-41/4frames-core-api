import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestLogContext = {
  readonly requestId: string;
  readonly correlationId: string;
  readonly authorizationHeader?: string;
};

export const requestLogContextStorage = new AsyncLocalStorage<RequestLogContext>();

export function getRequestLogContext(): RequestLogContext | undefined {
  return requestLogContextStorage.getStore();
}
