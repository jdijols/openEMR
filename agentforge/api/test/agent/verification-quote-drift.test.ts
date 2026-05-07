/**
 * G2-Final-FB-D-05 — quote-drift coverage.
 *
 * Locks the verification gate's substring check: a claim citing a chunk
 * whose `quote_or_value` is NOT a substring of the chunk's full source
 * text MUST be dropped, with the `verification.quote_drift_removed`
 * category emitted. Claims with no `citationQuoteSourceMap` snapshot
 * (e.g. lab_pdf citations not from evidence_retrieve) pass through —
 * those have their own S14 PDF cross-check surface.
 */
import { describe, expect, it } from 'vitest';
import { verifyClinicalBlocks } from '../../src/agent/verification.js';
import type { Observability } from '../../src/observability/index.js';
import type { ClinicalToolEvidence } from '../../src/agent/toolEvidence.js';
import type { ChatBlock } from '../../src/openemr/types.js';

function noopObs(events: string[]): Observability {
  return {
    async traceTurn(input) {
      return { id: 't', correlationId: input.correlationId };
    },
    async recordToolCall() {
      return { end: async () => {} };
    },
    async recordEvent(input: { name: string }) {
      events.push(input.name);
    },
    async recordLlmCall() {},
    async shutdown() {},
  };
}

function makeEvidence(
  snapshots: ReadonlyArray<readonly [string, { quote: string; sourceText: string }]>,
): ClinicalToolEvidence {
  return {
    citationUuids: new Set(snapshots.map(([id]) => id)),
    emptyBacked: new Map(),
    medRowsForConflict: [],
    crossPatientLeak: false,
    citationQuoteSourceMap: new Map(snapshots),
  };
}

describe('verification — quote drift (FB-D-05)', () => {
  it('drops a claim whose cited quote does NOT appear in the chunk text', async () => {
    const events: string[] = [];
    const evidence = makeEvidence([
      [
        'jnc8-bp#diabetes-mellitus',
        {
          quote: 'low-intensity statin therapy', // drifted — not in sourceText
          sourceText:
            'In adults with diabetes mellitus, treatment should be initiated at SBP 140 mm Hg. Adults with diabetes and elevated LDL benefit from high-intensity statin therapy.',
        },
      ],
    ]);
    const blocks: ChatBlock[] = [
      {
        type: 'claim',
        text: 'JNC8 supports low-intensity statin therapy',
        citation_ids: ['jnc8-bp#diabetes-mellitus'],
      },
    ];
    const out = await verifyClinicalBlocks(noopObs(events), 'cid', blocks, evidence);
    expect(out.some((b) => b.type === 'refusal')).toBe(true);
    expect(events).toContain('verification.quote_drift_removed');
  });

  it('keeps a claim whose cited quote IS a substring of the chunk text', async () => {
    const events: string[] = [];
    const evidence = makeEvidence([
      [
        'jnc8-bp#diabetes-mellitus',
        {
          quote: 'high-intensity statin therapy',
          sourceText:
            'Adults with diabetes and elevated LDL benefit from high-intensity statin therapy.',
        },
      ],
    ]);
    const blocks: ChatBlock[] = [
      {
        type: 'claim',
        text: 'JNC8 supports high-intensity statin therapy',
        citation_ids: ['jnc8-bp#diabetes-mellitus'],
      },
    ];
    const out = await verifyClinicalBlocks(noopObs(events), 'cid', blocks, evidence);
    expect(out.some((b) => b.type === 'claim')).toBe(true);
    expect(events).not.toContain('verification.quote_drift_removed');
  });

  it('passes through claims whose citation has no quote snapshot (lab_pdf surface)', async () => {
    const events: string[] = [];
    // citationUuids includes the id (so citesAny passes) but no snapshot exists.
    const evidence: ClinicalToolEvidence = {
      citationUuids: new Set(['lab-row-uuid-x']),
      emptyBacked: new Map(),
      medRowsForConflict: [],
      crossPatientLeak: false,
      citationQuoteSourceMap: new Map(),
    };
    const blocks: ChatBlock[] = [
      { type: 'claim', text: 'LDL 158 mg/dL persisted', citation_ids: ['lab-row-uuid-x'] },
    ];
    const out = await verifyClinicalBlocks(noopObs(events), 'cid', blocks, evidence);
    expect(out.some((b) => b.type === 'claim')).toBe(true);
    expect(events).not.toContain('verification.quote_drift_removed');
  });
});
