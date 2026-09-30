import { type Message } from '@aws-sdk/client-sqs';

/** O que o consumer faz com a mensagem depois do handler. Um erro lançado é tratado como falha transiente. */
export type MessageHandlerResult = { action: 'delete' } | { action: 'retry'; delaySeconds: number };

export type MessageHandler = (message: Message) => Promise<MessageHandlerResult>;

export const DELETE_MESSAGE: MessageHandlerResult = { action: 'delete' };
