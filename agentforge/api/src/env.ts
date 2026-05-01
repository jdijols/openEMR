import { z } from 'zod';

/**
 * §5.1.1 + §11.1 — validated at boot; missing keys → process.exit(1) via loadEnv.
 */
export const envSchema = z.object({
  LLM_PROVIDER: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  STT_PROVIDER: z.enum(['deepgram', 'assemblyai', 'mock']),
  STT_API_KEY: z.string().min(1),
  OPENEMR_MODULE_BASE_URL: z.string().url(),
  OPENEMR_MODULE_SHARED_SECRET: z.string().min(1),
  POSTGRES_URL: z.string().min(1),
  LANGFUSE_BASE_URL: z.string().url(),
  LANGFUSE_PUBLIC_KEY: z.string().min(1),
  LANGFUSE_SECRET_KEY: z.string().min(1),
  CUI_ALLOWED_ORIGINS: z.string().min(1),
  SESSION_TOKEN_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('Invalid environment', parsed.error.flatten().fieldErrors);
    throw new Error('env_validation_failed');
  }
  return parsed.data;
}

/** Parse `process.env` or exit 1 — use only from process entrypoints. */
export function loadEnv(): Env {
  try {
    return parseEnv(process.env);
  } catch {
    process.exit(1);
  }
}
