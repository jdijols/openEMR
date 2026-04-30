/**
 * G2-08 — orchestrator wiring.
 *
 * Mocks `generateText` from `ai` so the test never reaches a real LLM. Verifies:
 *  - tools are passed into the SDK call
 *  - structured `{blocks:[...]}` JSON from the model is parsed into typed blocks
 *  - free-text fallback wraps non-JSON output as a single text block
 *  - correlation id flows into observability stub (request + response phases)
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { testEnv } from '../helpers/env-fixture.js';

// vi.mock is hoisted; use vi.hoisted so the spy exists by the time the factory runs.
const { generateTextMock } = vi.hoisted(() => ({ generateTextMock: vi.fn() }));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

import { runChatTurn, parseBlocksFromModelText } from '../../src/agent/orchestrator.js';
import type { Observability } from '../../src/observability/index.js';
import { mintSessionToken } from '../../src/handshake/sessionToken.js';

function recordingObs(): {
  obs: Observability;
  events: { name: string; correlationId: string; meta?: Record<string, unknown> }[];
} {
  const events: { name: string; correlationId: string; meta?: Record<string, unknown> }[] = [];
  return {
    events,
    obs: {
      async traceTurn({ correlationId }) {
        events.push({ name: 'traceTurn', correlationId });
        return { id: 'trace-1', correlationId };
      },
      async recordToolCall({ correlationId, toolName, meta }) {
        events.push(
          meta === undefined
            ? { name: `tool:${toolName}`, correlationId }
            : { name: `tool:${toolName}`, correlationId, meta },
        );
      },
      async recordLlmCall({ correlationId, providerModel, meta }) {
        events.push(
          meta === undefined
            ? { name: `llm:${providerModel}`, correlationId }
            : { name: `llm:${providerModel}`, correlationId, meta },
        );
      },
    },
  };
}

beforeEach(() => {
  generateTextMock.mockReset();
});

describe('parseBlocksFromModelText', () => {
  it('parses a structured {blocks:[...]} JSON response', () => {
    const out = parseBlocksFromModelText(
      JSON.stringify({
        blocks: [
          { type: 'text', text: 'Hi.' },
          { type: 'claim', text: 'No allergies on file.', citation_ids: ['sp-1'] },
        ],
      }),
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ type: 'text', text: 'Hi.' });
    expect(out[1]).toMatchObject({ type: 'claim', citation_ids: ['sp-1'] });
  });

  it('parses a structured JSON response wrapped in a markdown code fence', () => {
    const out = parseBlocksFromModelText(`\`\`\`json
{
  "blocks": [
    { "type": "claim", "text": "Lisinopril allergy.", "citation_ids": ["sp-1"] }
  ]
}
\`\`\``);
    expect(out).toEqual([
      { type: 'claim', text: 'Lisinopril allergy.', citation_ids: ['sp-1'] },
    ]);
  });

  it('falls back to a single text block for non-JSON output', () => {
    const out = parseBlocksFromModelText('plain text answer');
    expect(out).toEqual([{ type: 'text', text: 'plain text answer' }]);
  });
});

describe('runChatTurn (PRD §5.7 wiring)', () => {
  it('passes tools to generateText and propagates correlation id', async () => {
    const env = testEnv();
    const { obs, events } = recordingObs();
    generateTextMock.mockResolvedValueOnce({
      text: JSON.stringify({
        blocks: [{ type: 'claim', text: 'No allergies.', citation_ids: ['sp-1'] }],
      }),
    });

    const sessionToken = mintSessionToken(
      { user_id: 1, patient_uuid: 'pat-1', encounter_id: null },
      env.SESSION_TOKEN_SECRET,
      Math.floor(Date.now() / 1000),
      600,
    );

    const out = await runChatTurn(
      env,
      obs,
      { sessionToken, patientUuid: 'pat-1', userMessage: 'list allergies' },
      'corr-xyz',
    );

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const args = generateTextMock.mock.calls[0]?.[0] as {
      tools: Record<string, unknown>;
      system: string;
      prompt: string;
    };
    expect(Object.keys(args.tools)).toEqual(['get_identity', 'get_allergies']);
    expect(args.system).toMatch(/clinical co-pilot/i);
    expect(args.prompt).toMatch(/pat-1/);
    expect(args.prompt).toMatch(/list allergies/);

    expect(out.blocks).toEqual([
      { type: 'claim', text: 'No allergies.', citation_ids: ['sp-1'] },
    ]);

    expect(events.map((e) => e.name)).toEqual([
      'traceTurn',
      `llm:${env.LLM_PROVIDER}`,
      `llm:${env.LLM_PROVIDER}`,
    ]);
    expect(events.every((e) => e.correlationId === 'corr-xyz')).toBe(true);
  });

  it('returns a typed text block when the model returns prose', async () => {
    const env = testEnv();
    const { obs } = recordingObs();
    generateTextMock.mockResolvedValueOnce({ text: 'I am unable to answer.' });
    const sessionToken = mintSessionToken(
      { user_id: 1, patient_uuid: 'pat-1', encounter_id: null },
      env.SESSION_TOKEN_SECRET,
      Math.floor(Date.now() / 1000),
      600,
    );

    const out = await runChatTurn(
      env,
      obs,
      { sessionToken, patientUuid: 'pat-1', userMessage: 'hi' },
      'corr-2',
    );
    expect(out.blocks).toEqual([{ type: 'text', text: 'I am unable to answer.' }]);
  });
});
