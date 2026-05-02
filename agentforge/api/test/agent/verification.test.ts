import { describe, expect, it } from 'vitest';
import { verifyClinicalBlocks, detectImpossibleBloodPressure } from '../../src/agent/verification.js';
import type { Observability } from '../../src/observability/index.js';
import type { ClinicalToolEvidence } from '../../src/agent/toolEvidence.js';
import type { ChatBlock } from '../../src/openemr/types.js';

function noopObs(): Observability {
  return {
    async traceTurn(input) {
      return { id: 't', correlationId: input.correlationId };
    },
    async recordToolCall() {
      return { end: async () => {} };
    },
    async recordEvent() {},
    async recordLlmCall() {},
    async shutdown() {},
  };
}

describe('detectImpossibleBloodPressure (§9.2)', () => {
  it('rejects outrageous systolic readings', () => {
    expect(detectImpossibleBloodPressure('320/80')).toBe('impossible_vital');
    expect(detectImpossibleBloodPressure('132 over 84')).toBe(null);
  });
});

describe('verifyClinicalBlocks (§9.1 §9.3 slices)', () => {
  const baseEvidence: ClinicalToolEvidence = {
    citationUuids: new Set(['med-uuid']),
    emptyBacked: new Map([['get_allergies', true]]),
    medRowsForConflict: [{ drugLower: 'metformin', statusLower: 'inactive', uuid: 'med-uuid' }],
    crossPatientLeak: false,
  };

  it('passes cited claims using segmented claims', async () => {
    const blocks: ChatBlock[] = [
      {
        type: 'claim',
        segments: [
          { type: 'text', text: 'On ' },
          { type: 'cite', text: 'metformin', citation_id: 'med-uuid' },
        ],
      },
    ];
    const out = await verifyClinicalBlocks(noopObs(), 'cid', blocks, baseEvidence);
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('claim');
    if (out[0]?.type === 'claim' && 'segments' in out[0]) {
      expect(out[0].segments).toBeDefined();
    }
  });

  it('passes cited claims referencing tool evidence', async () => {
    const blocks: ChatBlock[] = [{ type: 'claim', text: 'Metformin is listed.', citation_ids: ['med-uuid'] }];
    const out = await verifyClinicalBlocks(noopObs(), 'cid', blocks, baseEvidence);
    expect(out).toHaveLength(1);
    expect(out[0]?.type === 'claim').toBe(true);
  });

  it('removes uncited claims', async () => {
    const blocks: ChatBlock[] = [{ type: 'claim', text: 'A1c is 8.2', citation_ids: [] }];
    const out = await verifyClinicalBlocks(noopObs(), 'cid', blocks, baseEvidence);
    expect(out.some((b) => b.type === 'refusal')).toBe(true);
  });

  it('rejects negatives without empty backing allergies tool', async () => {
    const ev: ClinicalToolEvidence = {
      ...baseEvidence,
      emptyBacked: new Map(),
    };
    const blocks: ChatBlock[] = [
      { type: 'claim', text: 'Patient has no allergies on file.', citation_ids: ['med-uuid'] },
    ];
    const out = await verifyClinicalBlocks(noopObs(), 'cid', blocks, ev);
    expect(out.some((b) => b.type === 'refusal')).toBe(true);
  });
});
