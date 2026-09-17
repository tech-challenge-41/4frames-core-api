export interface IJwt {
  /**
   * Generates a JWT token
   * @param payload object containing the payload data
   * @param expiresIn token expiration time in seconds
   */
  generateToken(payload: object, expiresIn: number): string;
  /**
   * Verifies a JWT token
   * @param token the JWT token to verify
   */
  verifyToken(token: string): object | null;
}
