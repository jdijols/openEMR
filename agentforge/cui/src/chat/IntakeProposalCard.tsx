import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * §9 / G2-MVP-69 — read-only intake-proposal card at MVP. Displays the
 * extracted intake form across 5 sections (Demographics, Chief concern,
 * Current medications, Allergies, Family history). Confirm fires an
 * intent dispatch (stub at MVP — real per-section write tools land at
 * G2-Early-25 + 26). Reject discards the card.
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

export function IntakeProposalCard(props: IntakeProposalCardProps): ReactElement {
  const [state, setState] = useState<'idle' | 'pending' | 'confirmed' | 'rejected'>('idle');

  const fireConfirm = (): void => {
    setState('pending');
    // MVP: just log intent; real per-section dispatch lands at G2-Early-26.
    console.info('agentforge_intake_proposal_confirm_intent', {
      sections: ['demographics', 'chief_concern', 'current_medications', 'allergies', 'family_history'],
      n_meds: props.data.current_medications.length,
      n_allergies: props.data.allergies.length,
      n_family: props.data.family_history.length,
    });
    props.onConfirm();
    setState('confirmed');
  };

  const fireReject = (): void => {
    setState('rejected');
    props.onReject();
  };

  if (state === 'rejected') {
    return <div data-testid="intake-proposal-card-rejected" style={{ color: '#666', fontStyle: 'italic' }}>Proposal dismissed.</div>;
  }

  return (
    <div data-testid="intake-proposal-card" className="agentforge-cui__intake-proposal" style={{ border: '1px solid #d4d4d8', borderRadius: 8, padding: '1rem', margin: '0.5rem 0', background: '#fafafa' }}>
      <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '1rem' }}>New patient intake — confirm to bring into the chart</h3>

      <Section title="Demographics" testid="intake-section-demographics">
        <KV k="Name" v={props.data.demographics.name} />
        <KV k="DOB" v={props.data.demographics.dob} />
        <KV k="Sex" v={props.data.demographics.sex} />
        <KV k="Phone" v={props.data.demographics.contact_phone} />
      </Section>

      <Section title="Chief concern" testid="intake-section-chief-concern">
        <p style={{ margin: 0 }}>{props.data.chief_concern.text}</p>
        {props.data.chief_concern.onset != null && <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#666' }}>Onset: {props.data.chief_concern.onset}</p>}
      </Section>

      <Section title={`Current medications (${props.data.current_medications.length})`} testid="intake-section-medications">
        {props.data.current_medications.length === 0 ? (
          <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>None on file.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {props.data.current_medications.map((m, i) => (
              <li key={`${m.name}-${i}`}>{m.name}{m.dose != null && m.dose !== '' ? ` ${m.dose}` : ''}{m.frequency != null && m.frequency !== '' ? ` · ${m.frequency}` : ''}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Allergies (${props.data.allergies.length})`} testid="intake-section-allergies">
        {props.data.allergies.length === 0 ? (
          <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>None on file.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {props.data.allergies.map((a, i) => (
              <li key={`${a.substance}-${i}`}>{a.substance}{a.reaction != null && a.reaction !== '' ? ` — ${a.reaction}` : ''}{a.severity != null && a.severity !== '' ? ` (${a.severity})` : ''}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Family history (${props.data.family_history.length})`} testid="intake-section-family">
        {props.data.family_history.length === 0 ? (
          <p style={{ margin: 0, color: '#666', fontStyle: 'italic' }}>None on file.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {props.data.family_history.map((f, i) => (
              <li key={`${f.relation}-${i}`}>{f.relation}: {f.condition}</li>
            ))}
          </ul>
        )}
      </Section>

      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
        <button type="button" data-testid="intake-proposal-confirm" onClick={fireConfirm} disabled={state !== 'idle'} style={{ padding: '0.5rem 1rem', background: state === 'confirmed' ? '#16a34a' : '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: state === 'idle' ? 'pointer' : 'default' }}>
          {state === 'confirmed' ? 'Confirmed' : state === 'pending' ? 'Confirming…' : 'Confirm'}
        </button>
        <button type="button" data-testid="intake-proposal-reject" onClick={fireReject} disabled={state !== 'idle'} style={{ padding: '0.5rem 1rem', background: 'transparent', color: '#444', border: '1px solid #ccc', borderRadius: 4, cursor: state === 'idle' ? 'pointer' : 'default' }}>
          Reject
        </button>
      </div>
    </div>
  );
}

function Section(props: { title: string; testid?: string; children: React.ReactNode }): ReactElement {
  return (
    <section data-testid={props.testid} style={{ marginBottom: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.25rem 0', fontSize: '0.875rem', color: '#444' }}>{props.title}</h4>
      <div style={{ fontSize: '0.875rem' }}>{props.children}</div>
    </section>
  );
}

function KV(props: { k: string; v?: string | null }): ReactElement | null {
  if (props.v == null || props.v === '') {
    return null;
  }
  return (
    <p style={{ margin: '0.125rem 0' }}>
      <strong style={{ color: '#666' }}>{props.k}:</strong> {props.v}
    </p>
  );
}
