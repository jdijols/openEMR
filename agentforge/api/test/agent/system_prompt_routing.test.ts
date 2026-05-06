/**
 * §7 / G2-Early-12 — supervisor system-prompt branching rule coverage.
 *
 * Deterministic content tests over the rendered prompt: the rule text must
 * encode the four §7 branches (docref → extract; evidence-seeking → retrieve;
 * chart-only otherwise; final synthesis groups citations by evidence type).
 */

import { describe, it, expect } from 'vitest';
import { CLINICAL_SYSTEM_PROMPT } from '../../src/agent/system_prompt.js';

describe('§7 G2-Early-12 — system prompt routing rules', () => {
  it('Branch 1: docref_uuid in turn → call attach_and_extract first', () => {
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/docref_uuid/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/attach_and_extract/);
    // Explicit ordering signal — the rule must say the call is FIRST,
    // not interleaved with chart tools.
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/FIRST tool call/);
  });

  it('Branch 2: evidence-seeking phrasing → call evidence_retrieve', () => {
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/evidence_retrieve/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/should\s+(?:I|we)/i);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/recommend/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/intensify/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/guideline/);
  });

  it('Branch 3: chart-only questions → W1 chart tools alone', () => {
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/chart-record/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/W1 chart tools alone/);
    // Negative path: the prompt explicitly says NOT to call evidence_retrieve
    // when the question is purely about retrieving a stored chart fact.
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/Do not call evidence_retrieve/);
  });

  it('Branch 4: final synthesis groups citations by evidence type', () => {
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/final synthesis|Final synthesis/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/separate visual headings/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/guideline_chunk/);
    expect(CLINICAL_SYSTEM_PROMPT).toMatch(/lab_pdf|intake_form|openemr_record/);
  });
});
