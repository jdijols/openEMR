import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * G2-Final — persistent confirm/reject row pinned above the composer.
 *
 * Replaces the click-target portion of in-chat proposal cards for the
 * hybrid agent/manual flow. The chat thread still shows the agent's
 * text turns; this row is the always-visible save action so the
 * physician can confirm hands-free or by tap.
 *
 * Click on the body re-broadcasts `proposal:open_modal` so the
 * dashboard reopens the modal if the physician closed it.
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

export function AboveComposerAffordance(props: AboveComposerAffordanceProps): ReactElement {
  const [hoverConfirm, setHoverConfirm] = useState(false);
  const [hoverReject, setHoverReject] = useState(false);

  const label = labelForTarget(props.writeTarget);
  const submitting = props.state === 'submitting';
  const failed = props.state === 'failed';

  return (
    <div
      data-testid="above-composer-affordance"
      data-state={props.state}
      role="region"
      aria-label={`${label} — ${props.preview}`}
      className="agentforge-cui__above-composer"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        margin: '0 0 0.5rem 0',
        background: failed ? 'rgba(254, 226, 226, 0.6)' : 'rgba(239, 246, 255, 0.95)',
        border: `1px solid ${failed ? 'rgba(239, 68, 68, 0.4)' : 'rgba(37, 99, 235, 0.25)'}`,
        borderRadius: 8,
        fontSize: 13,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button') !== null) {
          return;
        }
        props.onReopen();
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: failed ? '#991b1b' : '#1e3a8a' }}>{label}</div>
        <div
          style={{
            color: '#475569',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={props.preview}
        >
          {failed && props.errorMessage !== undefined ? props.errorMessage : props.preview}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          type="button"
          data-testid="above-composer-confirm"
          aria-label="Confirm"
          disabled={submitting}
          onMouseEnter={() => setHoverConfirm(true)}
          onMouseLeave={() => setHoverConfirm(false)}
          onClick={(e) => {
            e.stopPropagation();
            if (!submitting) {
              props.onConfirm();
            }
          }}
          style={{
            all: 'unset',
            cursor: submitting ? 'wait' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 64,
            padding: '6px 12px',
            borderRadius: 6,
            background: submitting ? '#94a3b8' : hoverConfirm ? '#1d4ed8' : '#2563eb',
            color: '#fff',
            fontWeight: 600,
            fontSize: 13,
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Saving…' : '✓ Confirm'}
        </button>
        <button
          type="button"
          data-testid="above-composer-reject"
          aria-label="Reject"
          disabled={submitting}
          onMouseEnter={() => setHoverReject(true)}
          onMouseLeave={() => setHoverReject(false)}
          onClick={(e) => {
            e.stopPropagation();
            if (!submitting) {
              props.onReject();
            }
          }}
          style={{
            all: 'unset',
            cursor: submitting ? 'wait' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 64,
            padding: '6px 12px',
            borderRadius: 6,
            background: hoverReject ? '#e2e8f0' : '#f1f5f9',
            color: '#334155',
            fontWeight: 500,
            fontSize: 13,
            border: '1px solid #cbd5e1',
          }}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}
