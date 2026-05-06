import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import {
  ProposalCardShell,
  type ProposalCardActionsConfig,
  type ProposalCardState,
} from './ProposalCardShell.js';

/**
 * §9 / G2-MVP-69 — read-only intake-proposal card. Renders through the
 * shared `ProposalCardShell` so the visual identity (header chrome,
 * accent border, status pill, button row) matches the W1 vitals /
 * chief-complaint proposal cards exactly. The intake-specific bits
 * are the structured sections inside the body slot.
 *
 * Confirm fires an intent dispatch (stub at MVP — real per-section
 * write tools land at G2-Early-25 + 26). Reject discards the card.
 */

export type IntakeProposalData = {
  readonly demographics: { name?: string | null; dob?: string | null; sex?: string | null; contact_phone?: string | null };
  readonly chief_concern: { text: string; onset?: string | null };
  readonly current_medications: ReadonlyArray<{ name: string; dose?: string | null; frequency?: string | null }>;
  readonly allergies: ReadonlyArray<{ substance: string; reaction?: string | null; severity?: string | null }>;
  readonly family_history: ReadonlyArray<{ relation: string; condition: string }>;
};

export type IntakeProposalCardProps = {
  readonly data: IntakeProposalData;
  readonly onConfirm: () => void;
  readonly onReject: () => void;
};

type IntakeUiState = 'idle' | 'pending' | 'confirmed' | 'rejected';

function shellStateFor(ui: IntakeUiState): ProposalCardState {
  switch (ui) {
    case 'idle':
      return 'idle';
    case 'pending':
      return 'submitting';
    case 'confirmed':
      return 'accepted';
    case 'rejected':
      return 'declined';
  }
}

function statusFor(ui: IntakeUiState): string | undefined {
  switch (ui) {
    case 'pending':
      return 'Capturing…';
    case 'confirmed':
      // MVP scope: per-section dispatch (propose_allergy_write,
      // propose_chief_complaint_write, propose_clinical_note_write,
      // propose_medication_add, propose_family_history_add) lands at
      // G2-Early-26. The honest read is "captured for chart write,"
      // not "confirmed" — the latter promises persistence we don't
      // do yet.
      return 'Captured. Chart writes scheduled for next iteration (G2-Early-26).';
    case 'rejected':
      return 'Rejected.';
    case 'idle':
      return undefined;
  }
}

export function IntakeProposalCard(props: IntakeProposalCardProps): ReactElement {
  const [ui, setUi] = useState<IntakeUiState>('idle');

  const fireConfirm = (): void => {
    setUi('pending');
    // MVP: just log intent; real per-section dispatch lands at G2-Early-26.
    console.info('agentforge_intake_proposal_confirm_intent', {
      sections: ['demographics', 'chief_concern', 'current_medications', 'allergies', 'family_history'],
      n_meds: props.data.current_medications.length,
      n_allergies: props.data.allergies.length,
      n_family: props.data.family_history.length,
    });
    props.onConfirm();
    setUi('confirmed');
  };

  const fireReject = (): void => {
    setUi('rejected');
    props.onReject();
  };

  const showActions = ui === 'idle' || ui === 'pending';
  const actions: ProposalCardActionsConfig | undefined = showActions ?
    {
      onConfirm: fireConfirm,
      onReject: fireReject,
      confirmLabel: 'Confirm',
      rejectLabel: 'Reject',
      disabled: ui !== 'idle',
    }
  : undefined;

  const status = statusFor(ui);

  return (
    <ProposalCardShell
      state={shellStateFor(ui)}
      title="New patient intake"
      targetLabel="intake form"
      ariaLabel="Proposed new patient intake"
      {...(status !== undefined ? { statusMessage: status } : {})}
      {...(actions !== undefined ? { actions } : {})}
    >
      <Section title="Demographics">
        <KV k="Name" v={props.data.demographics.name ?? null} />
        <KV k="DOB" v={props.data.demographics.dob ?? null} />
        <KV k="Sex" v={props.data.demographics.sex ?? null} />
        <KV k="Phone" v={props.data.demographics.contact_phone ?? null} />
      </Section>

      <Section title="Chief concern">
        <p className="agentforge-msg__proposal-kv">{props.data.chief_concern.text}</p>
        {props.data.chief_concern.onset != null && props.data.chief_concern.onset !== '' ? (
          <p className="agentforge-msg__proposal-kv">
            <span className="agentforge-msg__proposal-kv-label">Onset:</span>
            {props.data.chief_concern.onset}
          </p>
        ) : null}
      </Section>

      <Section title={`Current medications (${props.data.current_medications.length})`}>
        {props.data.current_medications.length === 0 ? (
          <p className="agentforge-msg__proposal-section-empty">None on file.</p>
        ) : (
          <ul className="agentforge-msg__proposal-section-list">
            {props.data.current_medications.map((m, i) => (
              <li key={`${m.name}-${i}`}>
                {m.name}
                {m.dose != null && m.dose !== '' ? ` ${m.dose}` : ''}
                {m.frequency != null && m.frequency !== '' ? ` · ${m.frequency}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Allergies (${props.data.allergies.length})`}>
        {props.data.allergies.length === 0 ? (
          <p className="agentforge-msg__proposal-section-empty">None on file.</p>
        ) : (
          <ul className="agentforge-msg__proposal-section-list">
            {props.data.allergies.map((a, i) => (
              <li key={`${a.substance}-${i}`}>
                {a.substance}
                {a.reaction != null && a.reaction !== '' ? ` — ${a.reaction}` : ''}
                {a.severity != null && a.severity !== '' ? ` (${a.severity})` : ''}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Family history (${props.data.family_history.length})`}>
        {props.data.family_history.length === 0 ? (
          <p className="agentforge-msg__proposal-section-empty">None on file.</p>
        ) : (
          <ul className="agentforge-msg__proposal-section-list">
            {props.data.family_history.map((f, i) => (
              <li key={`${f.relation}-${i}`}>
                {f.relation}: {f.condition}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </ProposalCardShell>
  );
}

function Section(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="agentforge-msg__proposal-section">
      <h4 className="agentforge-msg__proposal-section-title">{props.title}</h4>
      {props.children}
    </section>
  );
}

function KV(props: { k: string; v: string | null }): ReactElement | null {
  if (props.v === null || props.v === '') {
    return null;
  }
  return (
    <p className="agentforge-msg__proposal-kv">
      <span className="agentforge-msg__proposal-kv-label">{props.k}:</span>
      {props.v}
    </p>
  );
}
