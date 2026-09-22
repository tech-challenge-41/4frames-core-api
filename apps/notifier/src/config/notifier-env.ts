import { parseEnv, redisEnvSchema, runtimeEnvSchema } from '@4frames/shared/env';
import { z } from 'zod';

export const notifierEnvSchema = runtimeEnvSchema.extend(redisEnvSchema.shape).extend({
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().min(1),
  WEB_APP_URL: z.url(),
  /** Varredura de jobs terminais sem `notified_at` (eventos Redis perdidos). */
  NOTIFIER_RECOVERY_INTERVAL_SECONDS: z.coerce.number().int().min(30).default(120),
  NOTIFIER_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20)
});

export type NotifierEnv = z.infer<typeof notifierEnvSchema>;

export function readNotifierEnv(source: Record<string, string | undefined> = process.env): NotifierEnv {
  const smtpPass = source.SMTP_PASS ?? source.SMTP_PASSWORD;

  return parseEnv(notifierEnvSchema, {
    ...source,
    SMTP_PASS: smtpPass === '' ? undefined : smtpPass
  });
}
