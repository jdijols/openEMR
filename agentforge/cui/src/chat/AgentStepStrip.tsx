import type { ReactElement } from 'react';
import { useState } from 'react';

/**
 * G2-Final-FB-A-03 — supervisor-handoff inline strip.
 *
 * Collapsed: one line — `Routed to <worker> · <duration>ms · <key stat>`.
 * Expanded: rationale (`reason`), `input_summary`, full `stats` payload.
 *
 * Visual identity matches `ProposalCardShell`: same accent border, same
 * subdued chrome, just a single-line summary instead of a card body. The
 * goal is for the strip to feel like part of the existing message flow,
 * not a separate panel.
 *
 * PHI-safe by construction: the props mirror what `synthesizeAgentSteps`
 * emits — counts, prefixes, doc_type, and stats only.
 */

export type AgentStepBlock = {
  readonly worker: 'intake_extractor' | 'evidence_retriever';
  readonly reason: string;
  readonly input_summary: Readonly<Record<string, unknown>>;
  readonly duration_ms: number;
  readonly outcome: 'ok' | 'no_results' | 'error';
  readonly stats?: Readonly<Record<string, unknown>>;
};

const WORKER_LABEL: Readonly<Record<AgentStepBlock['worker'], string>> = {
  intake_extractor: 'intake_extractor',
  evidence_retriever: 'evidence_retriever',
};

const OUTCOME_GLYPH: Readonly<Record<AgentStepBlock['outcome'], string>> = {
  ok: '✓',
  no_results: '∅',
  error: '⚠',
};

const OUTCOME_COLOR: Readonly<Record<AgentStepBlock['outcome'], string>> = {
  ok: '#1d8348',
  no_results: '#7f8c8d',
  error: '#c0392b',
};

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function buildKeyStat(block: AgentStepBlock): string {
  const stats = block.stats;
  if (block.worker === 'evidence_retriever') {
    if (stats === undefined) {
      return '';
    }
    const sparse = Number(stats['hits_sparse'] ?? 0);
    const dense = Number(stats['hits_dense'] ?? 0);
    const unioned = Number(stats['hits_unioned'] ?? 0);
    const reranked = Number(stats['hits_after_rerank'] ?? 0);
    return `sparse ${sparse} + dense ${dense} → ${unioned} unioned → ${reranked} reranked`;
  }
  if (block.worker === 'intake_extractor') {
    if (stats === undefined) {
      return '';
    }
    const schemaValid = stats['schema_valid'] === true;
    const factsTotal = Number(stats['facts_total'] ?? 0);
    const factsVerified = Number(stats['facts_verified'] ?? 0);
    const xcheck = typeof stats['cross_check_status'] === 'string' ? (stats['cross_check_status'] as string) : 'n/a';
    const schemaTag = schemaValid ? 'schema valid' : 'schema invalid';
    return `${schemaTag} · ${factsVerified}/${factsTotal} verified · ${xcheck}`;
  }
  return '';
}

export function AgentStepStrip(props: { readonly block: AgentStepBlock }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const { block } = props;
  const keyStat = buildKeyStat(block);

  return (
    <div
      data-testid="agent-step-strip"
      data-worker={block.worker}
      data-outcome={block.outcome}
      className="agentforge-msg__agent-step"
      style={{
        borderLeft: `3px solid ${OUTCOME_COLOR[block.outcome]}`,
        background: 'rgba(0,0,0,0.025)',
        padding: '0.4rem 0.6rem',
        margin: '0.25rem 0',
        fontSize: '0.85rem',
        color: '#444',
        borderRadius: '0 4px 4px 0',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        aria-expanded={expanded}
        aria-controls={`agent-step-${block.worker}-detail`}
        data-testid="agent-step-toggle"
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          width: '100%',
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true" style={{ color: OUTCOME_COLOR[block.outcome], marginRight: 6 }}>
          {OUTCOME_GLYPH[block.outcome]}
        </span>
        <span style={{ fontWeight: 600 }}>Routed to {WORKER_LABEL[block.worker]}</span>
        <span style={{ color: '#666' }}> · {formatDuration(block.duration_ms)}</span>
        {keyStat !== '' ? <span style={{ color: '#666' }}> · {keyStat}</span> : null}
        <span aria-hidden="true" style={{ float: 'right', color: '#999' }}>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <div
          id={`agent-step-${block.worker}-detail`}
          data-testid="agent-step-detail"
          style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(0,0,0,0.08)' }}
        >
          <p style={{ margin: '0 0 0.5rem 0', color: '#555' }}>
            <strong>Reason:</strong> {block.reason}
          </p>
          <details>
            <summary style={{ cursor: 'pointer', color: '#666' }}>input_summary</summary>
            <pre style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(block.input_summary, null, 2)}
            </pre>
          </details>
          {block.stats !== undefined ? (
            <details>
              <summary style={{ cursor: 'pointer', color: '#666' }}>stats</summary>
              <pre style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(block.stats, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
