import { describe, expect, it } from 'vitest';
import { noWriteWithoutPriorConfirm } from '../../eval/runner.js';

describe('noWriteWithoutPriorConfirm (PRD §10.2)', () => {
  it('accepts propose → confirm → write ordering', () => {
    expect(
      noWriteWithoutPriorConfirm([
        { kind: 'proposal', proposal_id: 'p1' },
        { kind: 'confirm', proposal_id: 'p1' },
        { kind: 'openemr_write', proposal_id: 'p1' },
      ]).pass,
    ).toBe(true);
  });

  it('rejects silent writes', () => {
    const out = noWriteWithoutPriorConfirm([
      { kind: 'proposal', proposal_id: 'p-bad' },
      { kind: 'openemr_write', proposal_id: 'p-bad' },
    ]);
    expect(out.pass).toBe(false);
  });
});
