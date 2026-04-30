import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const apiRoot = path.dirname(fileURLToPath(new URL('../../', import.meta.url)));

function runBootWithEnv(env: NodeJS.ProcessEnv): { status: number | null; stderr: string } {
  const tsxCli = path.join(apiRoot, 'node_modules/tsx/dist/cli.mjs');
  const res = spawnSync(process.execPath, [tsxCli, path.join(apiRoot, 'scripts/load-env-boot.ts')], {
    cwd: apiRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { status: res.status, stderr: res.stderr ?? '' };
}

describe('env boot', () => {
  it('exits non-zero when LLM_API_KEY is missing', () => {
    const { status } = runBootWithEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: '',
      STT_PROVIDER: 'deepgram',
      STT_API_KEY: 'k',
      OPENEMR_MODULE_BASE_URL: 'http://localhost:8300',
      OPENEMR_MODULE_SHARED_SECRET: 's',
      POSTGRES_URL: 'postgres://u:p@127.0.0.1:5432/db',
      LANGFUSE_BASE_URL: 'http://127.0.0.1:3100',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      CUI_ALLOWED_ORIGINS: 'http://localhost:5173',
      SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef01234567',
      LOG_LEVEL: 'info',
    });
    expect(status).not.toBe(0);
  });

  it('exits non-zero when LANGFUSE_BASE_URL is missing', () => {
    const { status } = runBootWithEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      STT_PROVIDER: 'deepgram',
      STT_API_KEY: 'k',
      OPENEMR_MODULE_BASE_URL: 'http://localhost:8300',
      OPENEMR_MODULE_SHARED_SECRET: 's',
      POSTGRES_URL: 'postgres://u:p@127.0.0.1:5432/db',
      LANGFUSE_BASE_URL: '',
      LANGFUSE_PUBLIC_KEY: 'pk',
      LANGFUSE_SECRET_KEY: 'sk',
      CUI_ALLOWED_ORIGINS: 'http://localhost:5173',
      SESSION_TOKEN_SECRET: '0123456789abcdef0123456789abcdef01234567',
      LOG_LEVEL: 'info',
    });
    expect(status).not.toBe(0);
  });
});
