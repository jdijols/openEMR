import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * G2-Final-FB-A-06 — PHI-redaction footer pill.
 *
 * Polls `GET <apiBase>/health/phi-redaction` every 60s. Three states:
 *   • green:   `all_caught === true`. The redactor is live, every PHI
 *              pattern in the synthetic fixture round-tripped clean.
 *   • red:     one or more patterns missed. The S7/S11 invariant broke.
 *   • unknown: endpoint threw or returned non-OK.
 *
 * Click expands to a side-by-side panel showing input vs redacted_sample
 * + per-pattern caught/missed list. Reviewer sees the redactor behave
 * live — no Langfuse trip needed.
 */

type ProbeResult = {
  readonly ok: true;
  readonly input_sample: string;
  readonly redacted_sample: string;
  readonly patterns_tested: readonly string[];
  readonly patterns_caught: readonly string[];
  readonly patterns_missed: readonly string[];
  readonly all_caught: boolean;
};

type Fetched = ProbeResult | { readonly state: 'unknown' };

const POLL_INTERVAL_MS = 60_000;

export type PhiRedactionBadgeProps = {
  readonly apiBase: string;
  readonly fetchImpl?: typeof fetch;
};

export function PhiRedactionBadge(props: PhiRedactionBadgeProps): ReactElement {
  const [status, setStatus] = useState<Fetched>({ state: 'unknown' });
  const [expanded, setExpanded] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const fetchImpl = props.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const url = `${stripTrailingSlash(props.apiBase)}/health/phi-redaction`;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetchImpl(url, { method: 'GET' });
        if (cancelledRef.current) return;
        if (res.ok) {
          const body = (await res.json()) as ProbeResult;
          setStatus(body);
          return;
        }
        setStatus({ state: 'unknown' });
      } catch {
        if (cancelledRef.current) return;
        setStatus({ state: 'unknown' });
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [props.apiBase, props.fetchImpl]);

  const variant = pickVariant(status);
  const label = pickLabel(status);

  return (
    <div className="agentforge-cui__phi-badge-wrap" data-testid="phi-redaction-badge">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        data-testid="phi-redaction-badge-toggle"
        data-variant={variant}
        aria-expanded={expanded}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: VARIANT_BG[variant],
          color: VARIANT_FG[variant],
          border: `1px solid ${VARIANT_BORDER[variant]}`,
          borderRadius: 999,
          padding: '2px 10px',
          fontSize: '0.75rem',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">{VARIANT_GLYPH[variant]}</span>
        <span>{label}</span>
      </button>
      {expanded && 'all_caught' in status ? (
        <div data-testid="phi-redaction-badge-detail" className="agentforge-cui__phi-badge-detail" style={DETAIL_STYLE}>
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>
            {status.all_caught ? '✓ All patterns caught' : '✗ One or more patterns missed'}
          </p>
          <p style={{ margin: '0 0 0.25rem 0', fontSize: '0.7rem', color: '#666' }}>Input (synthetic):</p>
          <pre style={CODE_STYLE}>{status.input_sample}</pre>
          <p style={{ margin: '0.5rem 0 0.25rem 0', fontSize: '0.7rem', color: '#666' }}>Redacted:</p>
          <pre style={CODE_STYLE}>{status.redacted_sample}</pre>
          <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.7rem', color: '#888' }}>
            {status.patterns_caught.length}/{status.patterns_tested.length} patterns caught
            {status.patterns_missed.length > 0 ? ` · missed: ${status.patterns_missed.join(', ')}` : ''}
          </p>
        </div>
      ) : null}
      {expanded && variant === 'unknown' ? (
        <div data-testid="phi-redaction-badge-unknown" className="agentforge-cui__phi-badge-detail" style={DETAIL_STYLE}>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>
            PHI redaction probe unavailable — check that the API is reachable.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const DETAIL_STYLE: React.CSSProperties = {
  position: 'absolute',
  bottom: '100%',
  right: 0,
  marginBottom: 6,
  background: '#fff',
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: '0.5rem 0.75rem',
  minWidth: 320,
  maxWidth: 520,
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  fontSize: '0.8rem',
  zIndex: 10,
};

const CODE_STYLE: React.CSSProperties = {
  margin: 0,
  background: 'rgba(0,0,0,0.04)',
  padding: '0.4rem 0.5rem',
  borderRadius: 4,
  fontSize: '0.7rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

function pickVariant(status: Fetched): 'green' | 'red' | 'unknown' {
  if ('state' in status) return 'unknown';
  return status.all_caught ? 'green' : 'red';
}

function pickLabel(status: Fetched): string {
  if ('state' in status) return 'PHI ?';
  return status.all_caught
    ? `PHI ✓ ${status.patterns_caught.length}/${status.patterns_tested.length}`
    : `PHI ✗ ${status.patterns_caught.length}/${status.patterns_tested.length}`;
}

const VARIANT_BG: Readonly<Record<'green' | 'red' | 'unknown', string>> = {
  green: 'rgba(29,131,72,0.12)',
  red: 'rgba(192,57,43,0.12)',
  unknown: 'rgba(0,0,0,0.05)',
};
const VARIANT_FG: Readonly<Record<'green' | 'red' | 'unknown', string>> = {
  green: '#1d8348',
  red: '#c0392b',
  unknown: '#666',
};
const VARIANT_BORDER: Readonly<Record<'green' | 'red' | 'unknown', string>> = {
  green: 'rgba(29,131,72,0.4)',
  red: 'rgba(192,57,43,0.4)',
  unknown: 'rgba(0,0,0,0.15)',
};
const VARIANT_GLYPH: Readonly<Record<'green' | 'red' | 'unknown', string>> = {
  green: '✓',
  red: '✗',
  unknown: '?',
};

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
