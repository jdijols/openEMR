import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import type { Env } from '../env.js';
import type { Observability } from '../observability/index.js';
import { chatBlockSchema, type ChatBlock } from '../openemr/types.js';
import { createGetAllergiesTool } from '../tools/get_allergies.js';
import { createGetIdentityTool } from '../tools/get_identity.js';
import { CLINICAL_SYSTEM_PROMPT } from './system_prompt.js';
import { getChatModel } from './model.js';

const blocksEnvelopeSchema = z.object({
  blocks: z.array(chatBlockSchema),
});

export function parseBlocksFromModelText(text: string): ChatBlock[] {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/u, '').trim();
  try {
    const raw: unknown = JSON.parse(trimmed);
    const parsed = blocksEnvelopeSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data.blocks;
    }
  } catch {
    /* fall through */
  }
  return [{ type: 'text', text: trimmed || '(empty model response)' }];
}

export type ChatTurnInput = {
  sessionToken: string;
  patientUuid: string;
  userMessage: string;
};

export async function runChatTurn(
  env: Env,
  observability: Observability,
  input: ChatTurnInput,
  correlationId: string,
): Promise<{ blocks: ChatBlock[] }> {
  const trace = await observability.traceTurn({ correlationId, turnName: 'chat' });

  const tools = {
    get_identity: createGetIdentityTool(env, input.sessionToken, observability, correlationId),
    get_allergies: createGetAllergiesTool(env, input.sessionToken, observability, correlationId),
  };

  const model = getChatModel(env);
  await observability.recordLlmCall({
    correlationId,
    providerModel: env.LLM_PROVIDER,
    meta: { phase: 'request' },
  });

  const result = await generateText({
    model,
    system: CLINICAL_SYSTEM_PROMPT,
    prompt: `patient_uuid for this turn: ${input.patientUuid}\n\nUser: ${input.userMessage}`,
    tools,
    stopWhen: stepCountIs(12),
  });

  await observability.recordLlmCall({
    correlationId,
    providerModel: env.LLM_PROVIDER,
    meta: { phase: 'response', traceId: trace.id },
  });

  return { blocks: parseBlocksFromModelText(result.text) };
}
