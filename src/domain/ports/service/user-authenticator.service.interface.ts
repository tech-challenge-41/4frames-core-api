import { type ID } from '@/domain/interfaces/id';

export interface AuthenticatedUserSession {
  accessToken: string;
  expireIn: number;
  user: {
    id: ID;
    email: string;
  };
}

export interface IUserAuthenticatorService {
  authenticate(email: string, password: string): Promise<AuthenticatedUserSession>;
}
