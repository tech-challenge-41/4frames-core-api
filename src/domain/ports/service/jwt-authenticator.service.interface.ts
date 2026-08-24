export interface AuthenticatedRequestUser {
  userId: number;
}

export interface IJwtAuthenticatorService {
  verifyAuthorizationHeader(authorizationHeader: string | undefined): Promise<AuthenticatedRequestUser>;
}
