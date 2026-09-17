export type UserAuthReason =
  | 'EMAIL_INVALID_PAYLOAD'
  | 'PASSWORD_INVALID_PAYLOAD'
  | 'INVALID_PASSWORD_LENGTH'
  | 'INVALID_CREDENTIALS'
  | 'USER_INACTIVE'
  | 'JWT_NOT_CONFIGURED';

export interface UserAuthSuccessPayload {
  authenticated: true;
  accessToken: string;
  expireIn: number;
  user: {
    id: number;
    email: string;
  };
}

export interface UserAuthFailurePayload {
  authenticated: false;
  reason: UserAuthReason;
  email?: string;
}

export type UserAuthPayload = UserAuthSuccessPayload | UserAuthFailurePayload;
