/**
 * Gate 5 G5-04 — finalized dictation can trigger the same confirm path as the Proposal card (PRD §6.5.1).
 */

import { postProposalConfirm } from '../api/client.js';
import { transcriptSegmentIndicatesConfirm } from './voice_confirm_intent.js';
import type { ProposalApiEnv } from './MessageList.js';

export async function tryConfirmProposalFromDictation(
  text: string,
  proposalId: string | null,
  env: ProposalApiEnv | undefined,
): Promise<boolean> {
  if (env === undefined || proposalId === null || proposalId.trim() === '') {
    return false;
  }
  if (!transcriptSegmentIndicatesConfirm(text)) {
    return false;
  }
  await postProposalConfirm(env.apiBase, env.sessionToken, env.patientUuid, env.conversationId, proposalId);
  return true;
}
