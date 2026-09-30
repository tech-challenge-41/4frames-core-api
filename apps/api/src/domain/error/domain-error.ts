import { type DomainErrorTypes } from './error-types';

export interface DomainErrorData {
  message: string;
  data?: Record<string, unknown>;
  type: DomainErrorTypes;
  context?: string;
}

interface DomainErrorToJsonResponse extends DomainErrorData {
  name: string;
  timestamp: string;
  context?: string;
  stack?: string;
}

export class DomainError extends Error {
  public readonly data: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly context?: string;
  public readonly type: DomainErrorTypes;
  public readonly name = 'DomainError';

  constructor({ message, data, context, type }: DomainErrorData) {
    super(message);
    this.type = type;
    this.data = data ? Object.freeze({ ...data }) : Object.freeze({});
    this.timestamp = new Date();
    this.context = context;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  public toJSON(): DomainErrorToJsonResponse {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      data: this.data,
      timestamp: this.timestamp.toISOString(),
      context: this.context,
      stack: this.stack
    };
  }

  public toString(): string {
    const parts = [`${this.name}: ${this.message}`];

    if (this.context) {
      parts.push(`Context: ${this.context}`);
    }

    if (Object.keys(this.data).length > 0) {
      parts.push(`Data: ${JSON.stringify(this.data)}`);
    }

    return parts.join(' | ');
  }
}
