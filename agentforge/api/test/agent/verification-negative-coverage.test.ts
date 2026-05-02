/**
 * Coverage matrix for the negative-claim regex layer (verification.ts §9.3).
 *
 * The regex set is intentionally narrow — it covers the highest-risk surfaces
 * (allergies, labs) with the most common phrasings. Paraphrases that slip
 * through are a documented limitation in VERIFICATION.md §"What verification
 * does NOT catch" §2.
 *
 * This test is the regression gate for that limitation. It asserts which
 * paraphrases the layer DOES catch (so the regex can't accidentally narrow)
 * AND which it does NOT catch (so the regex can't accidentally broaden
 * without an explicit doc update). If a row here flips outcome, either:
 *   - the regex changed intentionally → update VERIFICATION.md AND this matrix; or
 *   - the layer's plumbing regressed → fix the layer.
 *
 * The test exercises behavior end-to-end through `verifyClinicalBlocks`,
 * not the regex constants directly — so it catches any change that affects
 * the observable outcome (regex, control flow, or evidence wiring).
 */

import { describe, expect, it } from 'vitest';
import { verifyClinicalBlocks } from '../../src/agent/verification.js';
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

// Evidence with a valid citation but NO empty-backed observation for any tool.
// A claim citing 'cite-1' will pass the citation check; a claim that ALSO matches
// a negative-claim regex will be stripped (no backing) before the citation check.
const evidenceWithoutBacking: ClinicalToolEvidence = {
  citationUuids: new Set(['cite-1']),
  emptyBacked: new Map(),
  medRowsForConflict: [],
  crossPatientLeak: false,
};

/**
 * Run the verification layer over a single claim block and report whether
 * the claim survived (`passed`) or was stripped down to a refusal (`stripped`).
 */
async function classify(text: string): Promise<'stripped' | 'passed'> {
  const blocks: ChatBlock[] = [{ type: 'claim', text, citation_ids: ['cite-1'] }];
  const out = await verifyClinicalBlocks(noopObs(), 'cid', blocks, evidenceWithoutBacking);
  return out.some((b) => b.type === 'refusal') ? 'stripped' : 'passed';
}

describe('negative-claim coverage — allergies — patterns the regex DOES catch', () => {
  const caught = [
    'no allergies on file',
    'no known allergies',
    'patient has no allergies',
    'without allergies',
    'denies allergies',
    'denies any allergies',
    'no documented allergies',
  ];
  for (const text of caught) {
    it(`strips: "${text}"`, async () => {
      expect(await classify(text)).toBe('stripped');
    });
  }
});

describe('negative-claim coverage — allergies — paraphrases the regex MISSES (documented limitation)', () => {
  // These are real negative claims about allergies that V1's regex does not match.
  // They survive verification and reach the clinician unstripped. This is by design;
  // VERIFICATION.md §"What verification does NOT catch" §2 documents the gap.
  const missed = [
    'allergy-free patient',
    'patient is allergy-free',
    'allergies: none documented',
    'nothing remarkable in the allergy section',
    'allergic reactions are not present',
    'has not reported any allergies',
  ];
  for (const text of missed) {
    it(`passes (regex misses): "${text}"`, async () => {
      expect(await classify(text)).toBe('passed');
    });
  }
});

describe('negative-claim coverage — labs — patterns the regex DOES catch', () => {
  const caught = ['no labs on file', 'no recent labs', 'no lab', 'without recent labs'];
  for (const text of caught) {
    it(`strips: "${text}"`, async () => {
      expect(await classify(text)).toBe('stripped');
    });
  }
});

describe('negative-claim coverage — labs — paraphrases the regex MISSES (documented limitation)', () => {
  const missed = ['lab results unavailable', 'no records of bloodwork', 'lab section is empty'];
  for (const text of missed) {
    it(`passes (regex misses): "${text}"`, async () => {
      expect(await classify(text)).toBe('passed');
    });
  }
});

describe('negative-claim coverage — surfaces NOT covered by V1 (documented limitation)', () => {
  // V1 covers allergies + labs only. Negative claims about medications, conditions,
  // immunizations, and family history pass verification by design — there is no
  // regex covering those surfaces. Adding coverage is on the V2 roadmap (Theme 3).
  const uncoveredSurfaces = [
    'no current medications',
    'no chronic conditions',
    'no immunizations on file',
    'no relevant family history',
  ];
  for (const text of uncoveredSurfaces) {
    it(`passes (uncovered surface): "${text}"`, async () => {
      expect(await classify(text)).toBe('passed');
    });
  }
});
