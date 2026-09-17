export interface AwsClientOptions {
  /** Padrão: AWS_REGION, ou us-east-1. */
  region?: string;
  /** Padrão: AWS_ENDPOINT_URL (LocalStack em desenvolvimento). Sem valor, usa o endpoint real da AWS. */
  endpoint?: string;
}

export function resolveAwsClientOptions(
  { region, endpoint }: AwsClientOptions = {},
  env: NodeJS.ProcessEnv = process.env
): { region: string; endpoint?: string } {
  const resolvedEndpoint = endpoint ?? (env.AWS_ENDPOINT_URL?.trim() || undefined);

  return {
    region: region ?? (env.AWS_REGION?.trim() || 'us-east-1'),
    ...(resolvedEndpoint ? { endpoint: resolvedEndpoint } : {})
  };
}
