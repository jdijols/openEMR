/**
 * Unit test for the LLM-judge module. Exercises the parse+validate path with a
 * mocked Anthropic SDK client — no network calls, deterministic, fast.
 *
 * Verifies:
 *   - A well-formed JSON response from the model parses into the typed
 *     JudgeResult.
 *   - The score is clamped to [0,1] and `pass` falls back to `score >= 0.7`
 *     when the model omits it.
 *   - An unparseable response throws (does not silently swallow).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { _setClientForTesting, judgeCase } from '../../eval/judge/judge.js';

type MockResponse = {
  content: Array<{ type: 'text'; text: string }>;
  usage?: { input_tokens: number; output_tokens: number };
};

function makeMockClient(response: MockResponse): {
  messages: { create: () => Promise<MockResponse> };
} {
  return {
    messages: {
      create: async () => response,
    },
  };
}

describe('judgeCase', () => {
  let restore: (() => void) | null = null;

  afterEach(() => {
    if (restore !== null) {
      restore();
      restore = null;
    }
  });

  it('parses a well-formed JSON response into a typed JudgeResult', async () => {
    const mockJson = JSON.stringify({
      score: 0.85,
      pass: true,
      rationale: 'Trace shows the refusal block with the expected reason category.',
    });
    const client = makeMockClient({
      content: [{ type: 'text', text: mockJson }],
      usage: { input_tokens: 120, output_tokens: 40 },
    });
    // The Anthropic SDK type is structural enough that the duck-typed mock
    // satisfies the parts judgeCase touches (`messages.create`).
    restore = _setClientForTesting(client as unknown as Parameters<typeof _setClientForTesting>[0]);

    const result = await judgeCase({
      case_id: 'unit-test-case',
      rule: 'internal_disclosure_blocked',
      context: { blocks: [{ type: 'refusal', reason: 'internal_details_not_available' }] },
      expected: 'A refusal block must be present.',
    });

    expect(result.score).toBe(0.85);
    expect(result.pass).toBe(true);
    expect(result.rationale).toContain('refusal');
    expect(result.model).toBe('claude-sonnet-4-6');
    expect(result.prompt_version).toBe('v1-2026-05-09');
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
    expect(result.tokens).toEqual({ input: 120, output: 40 });
  });

  it('clamps score to [0,1] and derives pass from threshold when omitted', async () => {
    const mockJson = JSON.stringify({
      score: 1.42, // out of range — should clamp to 1.0
      rationale: 'over-scored',
      // no `pass` key — judgeCase must derive it from `score >= 0.7`.
    });
    const client = makeMockClient({
      content: [{ type: 'text', text: mockJson }],
    });
    restore = _setClientForTesting(client as unknown as Parameters<typeof _setClientForTesting>[0]);

    const result = await judgeCase({
      case_id: 'unit-test-clamp',
      rule: 'no_write_without_confirm',
      context: {},
      expected: 'expected text',
    });

    expect(result.score).toBe(1);
    expect(result.pass).toBe(true);
  });

  it('throws when the model returns no JSON object', async () => {
    const client = makeMockClient({
      content: [{ type: 'text', text: 'sorry, I cannot judge this case' }],
    });
    restore = _setClientForTesting(client as unknown as Parameters<typeof _setClientForTesting>[0]);

    await expect(
      judgeCase({
        case_id: 'unit-test-bad',
        rule: 'no_write_without_confirm',
        context: {},
        expected: 'x',
      }),
    ).rejects.toThrow(/judge_response_unparseable/u);
  });

  it('throws when the JSON is missing the score field', async () => {
    const client = makeMockClient({
      content: [{ type: 'text', text: JSON.stringify({ rationale: 'no score', pass: true }) }],
    });
    restore = _setClientForTesting(client as unknown as Parameters<typeof _setClientForTesting>[0]);

    await expect(
      judgeCase({
        case_id: 'unit-test-missing',
        rule: 'no_write_without_confirm',
        context: {},
        expected: 'x',
      }),
    ).rejects.toThrow(/judge_response_invalid/u);
  });
});
