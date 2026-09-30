import { parseEnv } from '@4frames/shared/env';
import { z } from 'zod';

export const DEFAULT_API_SHUTDOWN_TIMEOUT_SECONDS = 20;
/** Parte do prazo guardada para fechar Prisma e Redis depois que o servidor HTTP fechou. */
const RESOURCE_CLOSE_RESERVE_MS = 5_000;

export const shutdownEnvSchema = z.object({
  API_SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(DEFAULT_API_SHUTDOWN_TIMEOUT_SECONDS)
});

export interface ShutdownTimeouts {
  /** Prazo total do encerramento depois do SIGTERM. Fica abaixo do `terminationGracePeriodSeconds`. */
  shutdownTimeoutMs: number;
  /** Prazo para as requisições em curso terminarem. Depois dele, as conexões restantes são fechadas. */
  drainTimeoutMs: number;
}

export function readShutdownTimeouts(env: Record<string, string | undefined> = process.env): ShutdownTimeouts {
  const shutdownTimeoutMs = parseEnv(shutdownEnvSchema, env).API_SHUTDOWN_TIMEOUT_SECONDS * 1000;
  const reserveMs = Math.min(RESOURCE_CLOSE_RESERVE_MS, Math.floor(shutdownTimeoutMs / 4));

  return { shutdownTimeoutMs, drainTimeoutMs: shutdownTimeoutMs - reserveMs };
}
