import { describe, expect, it } from 'vitest';
import { transcriptSegmentIndicatesConfirm } from './voice_confirm_intent.js';

describe('transcriptSegmentIndicatesConfirm (PRD §6.5)', () => {
  it('matches dictation intents at phrase start', () => {
    expect(transcriptSegmentIndicatesConfirm('confirm')).toBe(true);
    expect(transcriptSegmentIndicatesConfirm('Confirm.')).toBe(true);
    expect(transcriptSegmentIndicatesConfirm('yes save allergy update')).toBe(true);
    expect(transcriptSegmentIndicatesConfirm('say confirm later')).toBe(false);
  });
});
