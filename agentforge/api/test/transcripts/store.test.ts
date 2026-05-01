/**
 * Gate 5 G5-01 — service guard rejects non-physician transcript segments (DB CHECK is belt-and-suspenders).
 */

import { describe, expect, it, vi } from 'vitest';
import { appendTranscriptSegment } from '../../src/transcripts/store.js';

describe('appendTranscriptSegment', () => {
  it('rejects speaker_role other than physician before querying', async () => {
    const pool = { connect: vi.fn(), query: vi.fn() } as never;

    await expect(
      appendTranscriptSegment(pool, {
        transcriptId: 1,
        seq: 1,
        speakerRole: 'patient',
        text: 'hello',
        isFinal: true,
      }),
    ).rejects.toMatchObject({ code: 'speaker_role_violation' });

    expect(pool.query).not.toHaveBeenCalled();
  });
});
