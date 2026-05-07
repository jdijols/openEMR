import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import {
  ProposalCardShell,
  type ProposalCardActionsConfig,
  type ProposalCardState,
} from './ProposalCardShell.js';
import {
  dispatchIntakeConfirm,
  type IntakeDispatchEnv,
  type IntakeDispatchOutcome,
  type SectionKey,
  type SectionOutcome,
} from './intake_dispatch.js';

/**
 * §9 / G2-MVP-69 + G2-Early-26 — intake-proposal card.
 *
 * Renders through the shared `ProposalCardShell` so the visual identity (header chrome,
 * accent border, status pill, button row) matches the W1 vitals / chief-complaint proposal
 * cards exactly. The intake-specific bits are the structured sections inside the body slot.
 *
 * G2-Early-26 — the Confirm button performs a per-section fan-out dispatch via the
 * `intake_dispatch` helper to the OpenEMR module's write endpoints. Per-section status pills
 * surface success / failure / skipped so the user sees exactly what landed in the chart.
 *
 * Read-only by design (G2-Final-10 per-row edit was removed at user request — too much UI
 * complexity for the marginal value, and physician corrections to extracted fields can flow
 * via the separate LLM `propose_demographics_update` / `propose_*` tool surfaces). The
 * card renders the extracted fields straight; user clicks Confirm to dispatch the full set
 * or Reject to discard.
 *
 * Confirm fires the dispatch only when `dispatchEnv` is supplied (post-handshake context).
 * Without it the card falls back to a stub log so the standalone vitest fixtures keep
 * working unchanged.
 */

export type IntakeProposalData = {
  readonly demographics: {
    legal_name_first?: string | null;
    legal_name_last?: string | null;
    legal_name_middle?: string | null;
    /** Legacy field kept for backward compatibility with vitest fixtures; renderer uses
     *  the split name fields when present, falls back to `name` otherwise. */
    name?: string | null;
    dob?: string | null;
    sex?: string | null;
    contact_phone?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    email?: string | null;
    occupation?: string | null;
  };
  readonly chief_concern: { text: string; onset?: string | null };
  readonly current_medications: ReadonlyArray<{
    name: string;
    dose?: string | null;
    frequency?: string | null;
    sig?: string | null;
    indication?: string | null;
    begdate?: string | null;
    enddate?: string | null;
  }>;
  readonly allergies: ReadonlyArray<{
    substance: string;
    reaction?: string | null;
    severity?: string | null;
    onset_date?: string | null;
    comments?: string | null;
  }>;
  readonly family_history: ReadonlyArray<{
    relation: string;
    condition: string;
    age_of_onset?: string | null;
    deceased?: boolean | null;
  }>;
};

export type IntakeProposalCardProps = {
  readonly data: IntakeProposalData;
  readonly onConfirm: () => void;
  readonly onReject: () => void;
  /** When provided, Confirm fires the real per-section dispatch. Without it, Confirm just logs. */
  readonly dispatchEnv?: IntakeDispatchEnv;
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

function statusFor(ui: IntakeUiState, dispatchOutcome: IntakeDispatchOutcome | null): string | undefined {
  switch (ui) {
    case 'pending':
      return 'Capturing…';
    case 'confirmed': {
      if (dispatchOutcome === null) {
        return 'Captured.';
      }
      const { totalAttempted, totalSucceeded } = dispatchOutcome;
      if (totalAttempted === 0) {
        return 'Captured. No rows to apply.';
      }
      if (totalSucceeded === totalAttempted) {
        return `Captured to chart. ${totalSucceeded} of ${totalAttempted} rows applied.`;
      }
      return `Partial. ${totalSucceeded} of ${totalAttempted} rows applied; see per-section status below.`;
    }
    case 'rejected':
      return 'Rejected.';
    case 'idle':
      return undefined;
  }
}

export function IntakeProposalCard(props: IntakeProposalCardProps): ReactElement {
  const [ui, setUi] = useState<IntakeUiState>('idle');
  const [dispatchOutcome, setDispatchOutcome] = useState<IntakeDispatchOutcome | null>(null);

  const fireConfirm = async (): Promise<void> => {
    setUi('pending');
    console.info('agentforge_intake_proposal_confirm_intent', {
      sections: ['demographics', 'chief_concern', 'current_medications', 'allergies', 'family_history'],
      n_meds: props.data.current_medications.length,
      n_allergies: props.data.allergies.length,
      n_family: props.data.family_history.length,
    });

    if (props.dispatchEnv !== undefined) {
      const outcome = await dispatchIntakeConfirm(props.dispatchEnv, props.data);
      setDispatchOutcome(outcome);
    }

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
      onConfirm: () => {
        void fireConfirm();
      },
      onReject: fireReject,
      confirmLabel: 'Confirm',
      rejectLabel: 'Reject',
      disabled: ui !== 'idle',
    }
  : undefined;

  const status = statusFor(ui, dispatchOutcome);

  return (
    <ProposalCardShell
      state={shellStateFor(ui)}
      title="New patient intake"
      targetLabel="intake form"
      ariaLabel="Proposed new patient intake"
      {...(status !== undefined ? { statusMessage: status } : {})}
      {...(actions !== undefined ? { actions } : {})}
    >
      <Section title="Demographics" outcome={null}>
        <KV k="Name" v={composeFullName(props.data.demographics) ?? null} />
        <KV k="DOB" v={props.data.demographics.dob ?? null} />
        <KV k="Sex" v={props.data.demographics.sex ?? null} />
        <KV k="Phone" v={props.data.demographics.contact_phone ?? null} />
        <KV k="Email" v={props.data.demographics.email ?? null} />
        <KV k="Address" v={composeAddress(props.data.demographics) ?? null} />
        <KV k="Occupation" v={props.data.demographics.occupation ?? null} />
      </Section>

      <Section title="Chief concern" outcome={findOutcome(dispatchOutcome, 'chief_concern')}>
        <p className="agentforge-msg__proposal-kv">{props.data.chief_concern.text}</p>
        {props.data.chief_concern.onset != null && props.data.chief_concern.onset !== '' ? (
          <p className="agentforge-msg__proposal-kv">
            <span className="agentforge-msg__proposal-kv-label">Onset:</span>
            {props.data.chief_concern.onset}
          </p>
        ) : null}
      </Section>

      <Section
        title={`Current medications (${props.data.current_medications.length})`}
        outcome={findOutcome(dispatchOutcome, 'current_medications')}
      >
        {props.data.current_medications.length === 0 ? (
          <p className="agentforge-msg__proposal-section-empty">None on file.</p>
        ) : (
          <ul className="agentforge-msg__proposal-section-list">
            {props.data.current_medications.map((m, i) => (
              <li key={`${m.name}-${i}`}>
                <strong>{m.name}</strong>
                {m.dose != null && m.dose !== '' ? ` ${m.dose}` : ''}
                {m.frequency != null && m.frequency !== '' ? ` · ${m.frequency}` : ''}
                {m.sig != null && m.sig !== '' && m.sig !== `${m.dose ?? ''} ${m.frequency ?? ''}`.trim() ? (
                  <span className="agentforge-msg__proposal-row-detail"> · {m.sig}</span>
                ) : null}
                {m.indication != null && m.indication !== '' ? (
                  <span className="agentforge-msg__proposal-row-detail"> · for {m.indication}</span>
                ) : null}
                {m.begdate != null && m.begdate !== '' ? (
                  <span className="agentforge-msg__proposal-row-detail"> · since {m.begdate}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={`Allergies (${props.data.allergies.length})`}
        outcome={findOutcome(dispatchOutcome, 'allergies')}
      >
        {props.data.allergies.length === 0 ? (
          <p className="agentforge-msg__proposal-section-empty">None on file.</p>
        ) : (
          <ul className="agentforge-msg__proposal-section-list">
            {props.data.allergies.map((a, i) => (
              <li key={`${a.substance}-${i}`}>
                <strong>{a.substance}</strong>
                {a.reaction != null && a.reaction !== '' ? ` — ${a.reaction}` : ''}
                {a.severity != null && a.severity !== '' ? ` (${a.severity})` : ''}
                {a.onset_date != null && a.onset_date !== '' ? (
                  <span className="agentforge-msg__proposal-row-detail"> · since {a.onset_date}</span>
                ) : null}
                {a.comments != null && a.comments !== '' ? (
                  <span className="agentforge-msg__proposal-row-detail"> · {a.comments}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={`Family history (${props.data.family_history.length})`}
        outcome={findOutcome(dispatchOutcome, 'family_history')}
      >
        {props.data.family_history.length === 0 ? (
          <p className="agentforge-msg__proposal-section-empty">None on file.</p>
        ) : (
          <ul className="agentforge-msg__proposal-section-list">
            {props.data.family_history.map((f, i) => (
              <li key={`${f.relation}-${i}`}>
                <strong>{f.relation}:</strong> {f.condition}
                {f.age_of_onset != null && f.age_of_onset !== '' ? (
                  <span className="agentforge-msg__proposal-row-detail"> · age {f.age_of_onset}</span>
                ) : null}
                {f.deceased === true ? (
                  <span className="agentforge-msg__proposal-row-detail"> · deceased</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </ProposalCardShell>
  );
}

function composeFullName(d: IntakeProposalData['demographics']): string | null {
  // Prefer the split fields (new schema). Fall back to legacy `name` for vitest
  // fixtures + backward compat.
  const parts = [d.legal_name_first, d.legal_name_middle, d.legal_name_last]
    .filter((p): p is string => p !== null && p !== undefined && p !== '');
  if (parts.length > 0) {
    return parts.join(' ');
  }
  return d.name ?? null;
}

function composeAddress(d: IntakeProposalData['demographics']): string | null {
  const street = d.street ?? '';
  const cityState = [d.city, d.state].filter((p) => p !== null && p !== undefined && p !== '').join(', ');
  const postal = d.postal_code ?? '';
  const tail = [cityState, postal].filter((p) => p !== '').join(' ');
  if (street === '' && tail === '') {
    return null;
  }
  if (street !== '' && tail !== '') {
    return `${street}, ${tail}`;
  }
  return street !== '' ? street : tail;
}

function findOutcome(
  dispatchOutcome: IntakeDispatchOutcome | null,
  section: SectionKey,
): SectionOutcome | null {
  if (dispatchOutcome === null) {
    return null;
  }
  return dispatchOutcome.sections.find((s) => s.section === section) ?? null;
}

function Section(props: {
  title: string;
  outcome: SectionOutcome | null;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="agentforge-msg__proposal-section">
      <header className="agentforge-msg__proposal-section-header">
        <h4 className="agentforge-msg__proposal-section-title">{props.title}</h4>
        {props.outcome !== null ? <SectionStatusPill outcome={props.outcome} /> : null}
      </header>
      {props.children}
    </section>
  );
}

function SectionStatusPill(props: { outcome: SectionOutcome }): ReactElement {
  const { outcome } = props;

  if (outcome.skippedReason !== undefined) {
    return (
      <span className="agentforge-msg__proposal-section-pill agentforge-msg__proposal-section-pill--neutral">
        Skipped — {outcome.skippedReason}
      </span>
    );
  }
  if (outcome.attempted === 0) {
    return (
      <span className="agentforge-msg__proposal-section-pill agentforge-msg__proposal-section-pill--neutral">
        No rows
      </span>
    );
  }
  if (outcome.succeeded === outcome.attempted) {
    return (
      <span className="agentforge-msg__proposal-section-pill agentforge-msg__proposal-section-pill--ok">
        ✓ {outcome.succeeded} of {outcome.attempted} applied
      </span>
    );
  }
  if (outcome.succeeded === 0) {
    const firstReason = outcome.rows.find((r) => !r.ok);
    const detail = firstReason !== undefined && !firstReason.ok ? firstReason.reason : 'rejected';
    return (
      <span className="agentforge-msg__proposal-section-pill agentforge-msg__proposal-section-pill--fail">
        ✗ failed — {detail}
      </span>
    );
  }
  return (
    <span className="agentforge-msg__proposal-section-pill agentforge-msg__proposal-section-pill--partial">
      ⚠ {outcome.succeeded} of {outcome.attempted} applied
    </span>
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
