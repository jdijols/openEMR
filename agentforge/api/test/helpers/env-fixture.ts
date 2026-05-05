import { parseEnv } from '../../src/env.js';
import type { Env } from '../../src/env.js';

export function testEnv(overrides: Partial<Record<string, string>> = {}): Env {
  const base: NodeJS.ProcessEnv = {
    LLM_PROVIDER: 'anthropic',
    LLM_API_KEY: 'test-llm-key',
    STT_PROVIDER: 'mock',
    STT_API_KEY: 'test-stt-key',
    OPENEMR_MODULE_BASE_URL: 'http://localhost:8300',
    OPENEMR_MODULE_SHARED_SECRET: 'test-shared-secret',
    POSTGRES_URL: 'postgres://u:p@127.0.0.1:5432/agentforge',
    LANGFUSE_BASE_URL: 'http://127.0.0.1:3100',
    LANGFUSE_PUBLIC_KEY: 'pk-test',
    LANGFUSE_SECRET_KEY: 'sk-test',
    CUI_ALLOWED_ORIGINS: 'http://localhost:5173',
    SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef01234567',
    COHERE_API_KEY: 'test-cohere-key',
    LOG_LEVEL: 'info',
    ...overrides,
  };
  return parseEnv(base);
}
