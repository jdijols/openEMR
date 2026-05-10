/**
 * G2-Final — cross-iframe coordination for the hybrid agent/manual proposal flow.
 *
 * Both the CUI iframe (this package) and the patient dashboard iframe
 * (`patient-dashboard/src/proposals/proposalBus.ts`) subscribe to the same
 * named BroadcastChannel. Same-origin iframes share BroadcastChannel, no
 * parent-window relay required.
 *
 * Keep the event shape in sync with the dashboard's mirror file.
 */

const CHANNEL_NAME = 'agentforge-proposals';

export type ProposalEvent =
  | {
      readonly type: 'proposal:open_modal';
      readonly proposal_id: string;
      readonly write_target: string;
      readonly patient_uuid: string;
    }
  | {
      readonly type: 'proposal:created';
      readonly proposal_id: string;
      readonly write_target: string;
      readonly patient_uuid: string;
      readonly source: 'cui' | 'dashboard';
    }
  | {
      readonly type: 'proposal:modal_closed';
      readonly proposal_id: string;
    }
  | {
      // G2-Final — generic "chart was written, please refresh" signal.
      // Fired by the CUI after any successful proposal confirmation
      // (legacy /conversations/:id/confirm OR new /proposals/:id/confirm)
      // so the dashboard can invalidate its FHIR react-query cache and
      // refetch. Without this, intake-form rows write to OpenEMR but the
      // dashboard cards keep showing the pre-write state until the
      // physician hard-reloads.
      readonly type: 'chart:updated';
      readonly patient_uuid: string;
      readonly source: 'cui' | 'dashboard';
    }
  | {
      // G2-Final — dashboard → CUI: this proposal was confirmed/rejected
      // outside the CUI (i.e. via the AllergyModal Save button). The CUI
      // marks the matching proposal block as resolved so its
      // above-composer affordance hides — without this signal the
      // affordance stays pinned even after a successful save, because the
      // CUI has no other way to know the proposal landed.
      readonly type: 'proposal:resolved';
      readonly proposal_id: string;
      readonly outcome: 'confirmed' | 'rejected';
    }
  | {
      // Phase 3 — CUI → dashboard: snapshot of the FIFO queue head used by
      // the dashboard to gate manual `+ add` actions. While an agent
      // proposal of the same `head_target` is at the head of the queue,
      // the corresponding card's `+` button disables itself with a tooltip
      // ("Resolve the pending allergy proposal first") so the physician
      // doesn't open a manual modal while the agent has one waiting.
      // `head_id === null` (count 0) means the queue is empty.
      readonly type: 'proposal:queue_state';
      readonly head_id: string | null;
      readonly head_target: string | null;
      readonly count: number;
    };

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  if (channel === null) {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
  return channel;
}

export function subscribe(handler: (event: ProposalEvent) => void): () => void {
  const ch = getChannel();
  if (ch === null) {
    return () => {};
  }
  const listener = (event: MessageEvent<ProposalEvent>): void => {
    if (event.data === null || typeof event.data !== 'object' || typeof event.data.type !== 'string') {
      return;
    }
    handler(event.data);
  };
  ch.addEventListener('message', listener);
  return () => ch.removeEventListener('message', listener);
}

export function broadcast(event: ProposalEvent): void {
  const ch = getChannel();
  if (ch === null) {
    return;
  }
  ch.postMessage(event);
}
