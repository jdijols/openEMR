/** PRD §6.5.1 finalized dictation ⇒ same handler as Proposal Confirm button */

export function transcriptSegmentIndicatesConfirm(segmentText: string): boolean {
  return /^(confirm|save|yes\s+save|yes\s+confirm)\b/im.test(segmentText.trim());
}
