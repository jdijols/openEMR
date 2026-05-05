import { describe, expect, it } from 'vitest';
import { buildW2DocumentNote } from '../../src/agent/w2_tools.js';

/**
 * §7 / G2-MVP-36 — orchestrator W2 turn-header routing.
 *
 * The full orchestrator runChatTurn integration is verified at the contract
 * level; here we test the pure helper that decides whether to append the
 * W2 "uploaded document available" instruction to the turn header.
 */

describe('§7 G2-MVP-36 — W2 turn-header note routing', () => {
  it('appends an attach_and_extract instruction when docref_uuid + doc_type are present', () => {
    const note = buildW2DocumentNote('docref-uuid-aaaa', 'lab_pdf');
    expect(note).toContain('attach_and_extract');
    expect(note).toContain('docref-uuid-aaaa');
    expect(note).toContain('lab_pdf');
    expect(note.length).toBeGreaterThan(40);
  });

  it('returns empty string when docref_uuid or doc_type is missing', () => {
    expect(buildW2DocumentNote(undefined, undefined)).toBe('');
    expect(buildW2DocumentNote('docref-uuid-aaaa', undefined)).toBe('');
    expect(buildW2DocumentNote(undefined, 'lab_pdf')).toBe('');
  });
});
