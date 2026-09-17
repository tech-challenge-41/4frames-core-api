export type JwtAuthReason = 'MISSING_AUTHORIZATION' | 'MISSING_TOKEN' | 'INVALID_TOKEN' | 'JWT_NOT_CONFIGURED';

export interface JwtAuthSuccessPayload {
  valid: true;
  userId: number;
}

export interface JwtAuthFailurePayload {
  valid: false;
  reason: JwtAuthReason;
  message: string;
}

export type JwtAuthPayload = JwtAuthSuccessPayload | JwtAuthFailurePayload;
