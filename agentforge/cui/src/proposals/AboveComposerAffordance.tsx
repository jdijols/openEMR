import type { ReactElement } from 'react';
import { ProposalCardShell, type ProposalCardState } from '../chat/ProposalCardShell.js';

/**
 * Phase 1 — persistent confirm/reject row pinned above the composer, rendered
 * via `ProposalCardShell` so the visual language matches the in-chat proposal
 * card (amber-on-cream "decision needed" treatment). Replaces the prior
 * CSS-in-JS implementation that read like a sent user-message bubble.
 *
 * The affordance always renders the FIFO head of the unresolved-proposal queue
 * (`findProposalQueue(messages).head` — see proposal_lookup.ts). The "1 of N"
 * queue counter renders OUTSIDE this component, in the wrapper stack at the
 * call site (App.tsx) — design call: counter belongs above-and-right of the
 * card itself, aligned to its right edge, rather than inside the card header
 * where it competes with the action label.
 *
 * After confirm / reject the queue advances to the next head; the consumer
 * keys this component on `proposalId` so the new head fades in via the
 * `agentforge-affordance-fade-in` animation rather than a content swap.
 *
 * Click on the body re-broadcasts `proposal:open_modal` so the dashboard
 * reopens the modal if the physician X-ed it out earlier (or, in Phase 3,
 * navigates to the encounter view for modal-less write targets).
 */

export type AboveComposerState = 'idle' | 'submitting' | 'failed';

export type AboveComposerAffordanceProps = Readonly<{
  proposalId: string;
  writeTarget: string;
  preview: string;
  state: AboveComposerState;
  onConfirm: () => void;
  onReject: () => void;
  onReopen: () => void;
  errorMessage?: string;
}>;

const ACTION_LABELS: Readonly<Record<string, string>> = {
  allergy: 'Save new allergy',
  allergy_delete: 'Remove allergy',
  medication_add: 'Save new medication',
  medication_discontinue: 'Discontinue medication',
  family_history_add: 'Save family history',
  document_delete: 'Remove document',
  demographics_update: 'Update demographics',
  vitals: 'Save vitals',
  vitals_delete: 'Void vitals',
  tobacco: 'Save tobacco status',
  chief_complaint: 'Save chief complaint',
  chief_complaint_delete: 'Clear chief complaint',
  clinical_note: 'Save clinical note',
  clinical_note_update: 'Update clinical note',
  clinical_note_delete: 'Delete clinical note',
};

function labelForTarget(target: string): string {
  return ACTION_LABELS[target] ?? 'Save change';
}

function shellStateFor(state: AboveComposerState): ProposalCardState {
  if (state === 'submitting') {
    return 'submitting';
  }
  if (state === 'failed') {
    return 'failed';
  }
  return 'idle';
}

export function AboveComposerAffordance(props: AboveComposerAffordanceProps): ReactElement {
  const label = labelForTarget(props.writeTarget);
  const submitting = props.state === 'submitting';
  const failed = props.state === 'failed';
  const previewText = failed && props.errorMessage !== undefined ? props.errorMessage : props.preview;

  return (
    <div
      data-testid="above-composer-affordance"
      data-state={props.state}
      data-proposal-id={props.proposalId}
      className="agentforge-cui__above-composer"
      onClick={(e) => {
        // Buttons inside the shell stop propagation themselves, but defense in
        // depth — body click should never fire when the click landed on a
        // Confirm / Reject button.
        if ((e.target as HTMLElement).closest('button') !== null) {
          return;
        }
        props.onReopen();
      }}
    >
      <ProposalCardShell
        title={label}
        state={shellStateFor(props.state)}
        ariaLabel={`${label} — ${props.preview}`}
        actions={{
          onConfirm: () => {
            if (!submitting) {
              props.onConfirm();
            }
          },
          onReject: () => {
            if (!submitting) {
              props.onReject();
            }
          },
          confirmLabel: submitting ? 'Saving…' : 'Confirm',
          rejectLabel: 'Reject',
          disabled: submitting,
        }}
      >
        <p
          className="agentforge-cui__above-composer-preview"
          title={props.preview}
        >
          {previewText}
        </p>
      </ProposalCardShell>
    </div>
  );
}
