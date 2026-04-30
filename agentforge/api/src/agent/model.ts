import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import type { Env } from '../env.js';

/**
 * PRD §5.7 — provider swap via env; Gate 2 implements Anthropic path first.
 */
export function getChatModel(env: Env): LanguageModel {
  if (env.LLM_PROVIDER !== 'anthropic') {
    throw new Error('unsupported_llm_provider_gate2');
  }

  const anthropic = createAnthropic({ apiKey: env.LLM_API_KEY });
  return anthropic('claude-haiku-4-5');
}
