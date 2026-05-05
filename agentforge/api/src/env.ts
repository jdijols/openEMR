import { z } from 'zod';

/**
 * §5.1.1 + §11.1 — validated at boot; missing keys → process.exit(1) via loadEnv.
 */
export const envSchema = z.object({
  LLM_PROVIDER: z.enum(['anthropic', 'openai_azure']),
  LLM_API_KEY: z.string().min(1),
  // Azure OpenAI (PRD §5.7, G6-15) — only consulted when LLM_PROVIDER=openai_azure.
  // The boot-time schema accepts them as optional so an `anthropic` deployment
  // does not need to populate them; per-provider cross-field validation lives
  // in `agent/model.ts` so we can throw typed errors usable by `/chat`.
  OPENAI_AZURE_RESOURCE_NAME: z.string().min(1).optional(),
  OPENAI_AZURE_BASE_URL: z.string().url().optional(),
  OPENAI_AZURE_DEPLOYMENT_ID: z.string().min(1).optional(),
  OPENAI_AZURE_API_VERSION: z.string().min(1).optional(),
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
  // §8 / G2-MVP-53 — Cohere Rerank API key. The W2 hybrid retriever feeds
  // Cohere Rerank with the union of sparse + dense candidates and returns
  // the top 3-5 to the supervisor. Required at boot so misconfigured
  // deployments fail loud rather than silently degrading retrieval.
  COHERE_API_KEY: z.string().min(1),
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
