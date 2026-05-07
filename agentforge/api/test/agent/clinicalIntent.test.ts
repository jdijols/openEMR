/**
 * Coverage for the deterministic clinical-intent classifier (P0-A).
 *
 * The classifier is the gate for mandatory `evidence_retrieve` — if it
 * mis-classifies, the user either (a) doesn't get evidence on a treatment-
 * decision question (regression to the bug we fixed) or (b) wastes a DB
 * round-trip + Cohere rerank on a chart-record question. These tests pin
 * the boundary cases.
 */

import { describe, expect, it } from 'vitest';
import { classifyClinicalIntent } from '../../src/agent/clinicalIntent.js';

describe('classifyClinicalIntent — clinical (mandatory retrieval should fire)', () => {
  it.each([
    ['Given her LDL of 158 and her T2DM, should we intensify her statin?', 'treatment_decision'],
    ['Should I start metformin given her A1c of 8.2?', 'treatment_decision'],
    ['Is it time to start an ACE inhibitor?', 'treatment_decision'],
    ['What does the guideline say about statin therapy?', 'treatment_decision'],
    ['According to ADA, what is her LDL target?', 'treatment_decision'],
    ['What is the evidence for switching to a higher-intensity statin?', 'treatment_decision'],
    ['Should we screen for diabetes given her risk factors?', 'treatment_decision'],
    ['How should we manage her blood pressure?', 'treatment_decision'],
    ['What is her cardiovascular risk?', 'treatment_decision'],
    ['What is the appropriate dose for her weight?', 'treatment_decision'],
    ['What is her ASCVD risk?', 'treatment_decision'],
  ])('%s → clinical (%s)', (msg, reason) => {
    const result = classifyClinicalIntent(msg);
    expect(result.isClinical).toBe(true);
    expect(result.reason).toBe(reason);
  });

  it('falls through to open_question for question-form clinical phrasing not caught by keywords', () => {
    const result = classifyClinicalIntent('What about her cholesterol levels?');
    expect(result.isClinical).toBe(true);
    expect(result.reason).toBe('open_question');
  });
});

describe('classifyClinicalIntent — non-clinical (no mandatory retrieval)', () => {
  it.each([
    ['BP is 140/90.', 'dictation'],
    ['Started on lisinopril 10 mg.', 'dictation'],
    ['Patient reports headaches.', 'dictation'],
    ['Abdomen soft, non-tender.', 'dictation'],
    ['A1c low.', 'dictation'],
    ['Looks well today.', 'dictation'],
    ['Follow up in 2 weeks.', 'dictation'],
  ])('declarative dictation %s → dictation', (msg, reason) => {
    const result = classifyClinicalIntent(msg);
    expect(result.isClinical).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it.each([
    ['What is her LDL?', 'chart_only'],
    ['What is her current A1C?', 'chart_only'],
    ['Show me her last vitals', 'chart_only'],
    ['Pull up her recent labs', 'chart_only'],
    ['List her medications', 'chart_only'],
  ])('chart-only retrieval %s → chart_only', (msg, reason) => {
    const result = classifyClinicalIntent(msg);
    expect(result.isClinical).toBe(false);
    expect(result.reason).toBe(reason);
  });

  it('empty message → not clinical (empty)', () => {
    const result = classifyClinicalIntent('');
    expect(result.isClinical).toBe(false);
    expect(result.reason).toBe('empty');
  });
});

describe('classifyClinicalIntent — chart-only + treatment-decision keyword wins', () => {
  // If a message contains BOTH a chart-only phrase AND a treatment-decision
  // keyword, the treatment-decision signal should dominate. Better to
  // over-retrieve than miss a real clinical question.
  it('"What is her LDL — should we intensify?" → clinical', () => {
    const result = classifyClinicalIntent('What is her LDL — should we intensify her statin?');
    expect(result.isClinical).toBe(true);
    expect(result.reason).toBe('treatment_decision');
  });
});
