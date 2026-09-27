/** Uma dependência sem a qual a API não consegue atender (banco, Redis). O `GET /ready` consulta todas. */
export interface IDependencyHealthIndicator {
  /** Nome da dependência no corpo do `GET /ready`. */
  readonly name: string;
  /** Resolve se a dependência respondeu; rejeita se não. */
  check(): Promise<void>;
}
