/**
 * G2-Final-FB-D-03 — `citation_quote_in_source` rule coverage.
 *
 * Locks the substring check across happy + drift + missing-quote +
 * empty-source paths so the FB-D-04 cases (cross-patient leak rejected
 * + post-rerank quote drift rejected) have a verified rule under them.
 */
import { describe, it, expect } from 'vitest';
import { citationQuoteInSource } from '../../eval/runner.js';

describe('citationQuoteInSource (FB-D-03)', () => {
  const sourceText =
    'In adults with diabetes mellitus aged 18 or older, treatment should be initiated at SBP 140 mm Hg. ' +
    'Adults with diabetes and elevated LDL benefit from high-intensity statin therapy.';

  it('passes when every quote_or_value appears as substring of source_text', () => {
    const out = citationQuoteInSource({
      citations: [
        { quote_or_value: 'SBP 140 mm Hg' },
        { quote_or_value: 'high-intensity statin therapy' },
      ],
      source_text: sourceText,
    });
    expect(out.pass).toBe(true);
  });

  it('fails when one quote drifted off the cited chunk text', () => {
    const out = citationQuoteInSource({
      citations: [
        { quote_or_value: 'SBP 140 mm Hg' },
        { quote_or_value: 'low-intensity statin therapy' }, // drifted
      ],
      source_text: sourceText,
    });
    expect(out.pass).toBe(false);
    expect(out.reason).toContain('not present');
  });

  it('fails when a citation has an empty quote', () => {
    const out = citationQuoteInSource({
      citations: [{ quote_or_value: '' }],
      source_text: sourceText,
    });
    expect(out.pass).toBe(false);
  });

  it('fails when source_text is empty', () => {
    const out = citationQuoteInSource({
      citations: [{ quote_or_value: 'anything' }],
      source_text: '',
    });
    expect(out.pass).toBe(false);
  });

  it('fails when no citations are present', () => {
    const out = citationQuoteInSource({ citations: [], source_text: sourceText });
    expect(out.pass).toBe(false);
  });
});
