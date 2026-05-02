import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import type { LanguageModel } from 'ai';
import type { Env } from '../env.js';

/**
 * PRD §5.7 / G6-15 — env-only LLM provider swap.
 *
 * Two providers are wired into the production stack:
 *   - `anthropic`     : Claude via the Vercel AI SDK Anthropic provider.
 *   - `openai_azure`  : Azure-hosted OpenAI (deployment-id based).
 *
 * The boot-time `envSchema` only constrains `LLM_PROVIDER` to the closed enum;
 * cross-field validation for the Azure-specific keys lives here so we can throw
 * typed errors that `/present-patient` and `/chat` translate into the documented
 * `501 misconfigured` response (PRD §5.7.2).
 */

export const ANTHROPIC_DEFAULT_MODEL_ID = 'claude-haiku-4-5';

/**
 * Canonical model identifier for a given provider env. Returned as a string
 * Langfuse's model-price database can match against (Anthropic publishes
 * `claude-haiku-4-5`; Azure OpenAI uses the deployment id as the model name).
 *
 * Falls back to the provider name if a per-provider id is somehow missing
 * — never throws, since this is called on the observability path.
 */
export function getProviderModelId(env: Env): string {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':
      return ANTHROPIC_DEFAULT_MODEL_ID;
    case 'openai_azure':
      return env.OPENAI_AZURE_DEPLOYMENT_ID ?? 'openai_azure';
    default:
      return env.LLM_PROVIDER;
  }
}

export class UnsupportedLlmProviderError extends Error {
  constructor(public readonly provider: string) {
    super('unsupported_llm_provider');
  }
}

export class OpenAiAzureMissingDeploymentIdError extends Error {
  constructor() {
    super('openai_azure_missing_deployment_id');
  }
}

export class OpenAiAzureMissingEndpointError extends Error {
  constructor() {
    super('openai_azure_missing_endpoint');
  }
}

export function getChatModel(env: Env): LanguageModel {
  switch (env.LLM_PROVIDER) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: env.LLM_API_KEY });
      return anthropic(ANTHROPIC_DEFAULT_MODEL_ID);
    }
    case 'openai_azure':
      return buildAzureModel(env);
    default: {
      // `LLM_PROVIDER` is constrained to the enum at boot, so this is only
      // reachable if the schema and this switch drift apart. Surface the
      // mismatch loudly instead of silently falling through.
      const provider: string = env.LLM_PROVIDER;
      throw new UnsupportedLlmProviderError(provider);
    }
  }
}

function buildAzureModel(env: Env): LanguageModel {
  const deploymentId = env.OPENAI_AZURE_DEPLOYMENT_ID;
  if (!deploymentId) {
    throw new OpenAiAzureMissingDeploymentIdError();
  }

  const resourceName = env.OPENAI_AZURE_RESOURCE_NAME;
  const baseURL = env.OPENAI_AZURE_BASE_URL;
  if (!resourceName && !baseURL) {
    throw new OpenAiAzureMissingEndpointError();
  }

  const azure = createAzure({
    apiKey: env.LLM_API_KEY,
    // `baseURL` wins over `resourceName` when both are set (matches the SDK's
    // documented behavior). Either path is valid for Azure-OpenAI v1.
    ...(baseURL ? { baseURL } : {}),
    ...(resourceName && !baseURL ? { resourceName } : {}),
    ...(env.OPENAI_AZURE_API_VERSION ? { apiVersion: env.OPENAI_AZURE_API_VERSION } : {}),
  });
  return azure(deploymentId);
}
