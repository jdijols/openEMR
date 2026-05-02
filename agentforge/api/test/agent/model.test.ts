/**
 * G6-15 — env-only LLM provider swap (PRD §5.7).
 *
 * Acceptance: stack constructs a usable `LanguageModel` for both
 * `LLM_PROVIDER=anthropic` and `LLM_PROVIDER=openai_azure` without code
 * changes — only env overrides. Failure modes (Azure missing endpoint /
 * deployment, unsupported provider) are typed and explicit.
 */

import { describe, expect, it } from 'vitest';
import { getChatModel } from '../../src/agent/model.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('getChatModel — provider swap (G6-15)', () => {
  it('returns an Anthropic-backed model when LLM_PROVIDER=anthropic', () => {
    const env = testEnv({ LLM_PROVIDER: 'anthropic' });
    const model = getChatModel(env);
    expect(model).toBeDefined();
    // The Vercel AI SDK's LanguageModel exposes a `modelId`.
    expect(typeof (model as { modelId: unknown }).modelId).toBe('string');
  });

  it('returns an Azure OpenAI-backed model with resourceName + deployment id', () => {
    const env = testEnv({
      LLM_PROVIDER: 'openai_azure',
      OPENAI_AZURE_RESOURCE_NAME: 'my-test-resource',
      OPENAI_AZURE_DEPLOYMENT_ID: 'gpt-4o-mini-prod',
    });
    const model = getChatModel(env);
    expect(model).toBeDefined();
    expect(typeof (model as { modelId: unknown }).modelId).toBe('string');
  });

  it('accepts OPENAI_AZURE_BASE_URL as an alternative to resourceName', () => {
    const env = testEnv({
      LLM_PROVIDER: 'openai_azure',
      OPENAI_AZURE_BASE_URL: 'https://proxy.example.com/azure-oai',
      OPENAI_AZURE_DEPLOYMENT_ID: 'gpt-4o-mini-prod',
    });
    const model = getChatModel(env);
    expect(model).toBeDefined();
  });

  it('throws openai_azure_missing_deployment_id when deployment id is absent', () => {
    const env = testEnv({
      LLM_PROVIDER: 'openai_azure',
      OPENAI_AZURE_RESOURCE_NAME: 'my-test-resource',
    });
    expect(() => getChatModel(env)).toThrowError('openai_azure_missing_deployment_id');
  });

  it('throws openai_azure_missing_endpoint when neither resource nor base URL is set', () => {
    const env = testEnv({
      LLM_PROVIDER: 'openai_azure',
      OPENAI_AZURE_DEPLOYMENT_ID: 'gpt-4o-mini-prod',
    });
    expect(() => getChatModel(env)).toThrowError('openai_azure_missing_endpoint');
  });
});
