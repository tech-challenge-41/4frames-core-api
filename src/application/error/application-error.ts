export interface ApplicationErrorData {
  message: string;
  data?: Record<string, unknown>;
  context?: string;
  status?: number;
}

export class ApplicationError extends Error {
  public readonly data: Record<string, unknown>;
  public readonly timestamp: Date;
  public readonly context?: string;
  public readonly name = ApplicationError.name;
  public readonly status?: number;

  constructor({ message, data, context, status }: ApplicationErrorData) {
    super(message);
    this.data = data ? Object.freeze({ ...data }) : Object.freeze({});
    this.timestamp = new Date();
    this.context = context;
    this.status = status;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
