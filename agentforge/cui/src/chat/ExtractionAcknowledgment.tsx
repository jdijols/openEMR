import type { ReactElement } from 'react';

/**
 * §9 / G2-MVP-68 — two-message extraction acknowledgment pattern:
 *   Pending: "Got it. Reading the document now…" with spinner.
 *   Resolved: a doc-type-templated headline + invitation pattern.
 */

export type ExtractionStatus =
  | { readonly status: 'pending'; readonly docType: 'lab_pdf' | 'intake_form'; readonly fileName: string }
  | {
      readonly status: 'resolved';
      readonly docType: 'lab_pdf' | 'intake_form';
      readonly fileName: string;
      readonly nFacts: number;
      readonly nAbnormal?: number;
    };

export function ExtractionAcknowledgment(props: { readonly status: ExtractionStatus }): ReactElement {
  if (props.status.status === 'pending') {
    return (
      <div data-testid="extraction-ack-pending" className="agentforge-cui__extraction-ack" role="status">
        <span aria-hidden="true" className="agentforge-cui__spinner" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', border: '2px solid #888', borderTopColor: 'transparent', animation: 'agentforge-spin 800ms linear infinite', marginRight: 8 }} />
        <span>Got it. Reading the document now…</span>
      </div>
    );
  }

  const headline = buildHeadline(props.status);
  return (
    <div data-testid="extraction-ack-resolved" className="agentforge-cui__extraction-ack">
      <p style={{ margin: '0 0 0.25rem 0', fontWeight: 600 }}>{headline}</p>
      <p style={{ margin: 0, color: '#444' }}>{buildInvitation(props.status.docType)}</p>
    </div>
  );
}

function buildHeadline(s: Extract<ExtractionStatus, { status: 'resolved' }>): string {
  if (s.docType === 'lab_pdf') {
    const abn = s.nAbnormal ?? 0;
    return `Read the lab — ${s.nFacts} result${s.nFacts === 1 ? '' : 's'}${abn > 0 ? `, ${abn} abnormal` : ''}.`;
  }
  return `Read the intake form — ${s.nFacts} field${s.nFacts === 1 ? '' : 's'} extracted.`;
}

function buildInvitation(docType: 'lab_pdf' | 'intake_form'): string {
  if (docType === 'lab_pdf') {
    return 'Click any value below to see it on the source PDF, or ask me what stands out.';
  }
  return 'Review and confirm the proposal below to bring this into the chart.';
}
