import type { ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';

/**
 * G2-Final-FB-A-05 — eval-gate footer pill.
 *
 * Polls `GET <apiBase>/health/eval-status` every 60s. Three visual states:
 *   • green: 0 cases failed AND 0 gate breaches.
 *   • red:   any cases failed OR any gate breach.
 *   • unknown (gray): endpoint 503'd or fetch threw — the CUI doesn't
 *     pretend to know.
 *
 * Click expands a small modal showing per-category pass-rate + counts +
 * baseline_version + run_id prefix + timestamp. Reviewer reads the
 * snapshot live from the deployed app — no GitHub or Langfuse trip.
 *
 * **Footer is a new render slot** — does not displace any existing CUI
 * affordance. Feature parity preserved.
 */

type PerCategory = Readonly<Record<string, { pass_rate: number; case_count: number }>>;

type EvalStatusOk = {
  readonly ok: true;
  readonly run_id: string;
  readonly ran_at: string;
  readonly cases_total: number;
  readonly cases_failed: number;
  readonly perf_over_budget: boolean;
  readonly baseline_version: string | null;
  readonly gate_breaches_count: number;
  readonly per_category: PerCategory;
};

type EvalStatusErr = { readonly ok: false; readonly error: string; readonly reason?: string };

export type EvalStatusFetched = EvalStatusOk | EvalStatusErr | { readonly state: 'unknown' };

const POLL_INTERVAL_MS = 60_000;

export type EvalGateBadgeProps = {
  readonly apiBase: string;
  /** Test seam — defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
};

export function EvalGateBadge(props: EvalGateBadgeProps): ReactElement {
  const [status, setStatus] = useState<EvalStatusFetched>({ state: 'unknown' });
  const [expanded, setExpanded] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const fetchImpl = props.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const url = `${stripTrailingSlash(props.apiBase)}/health/eval-status`;
    const tick = async (): Promise<void> => {
      try {
        const res = await fetchImpl(url, { method: 'GET' });
        if (cancelledRef.current) return;
        if (res.ok) {
          const body = (await res.json()) as EvalStatusOk;
          setStatus(body);
          return;
        }
        // 503 → endpoint says no reports yet. Surface as "unknown" rather
        // than mislabeling as red — there's no regression to alert on.
        const errBody = (await res.json().catch(() => ({}))) as EvalStatusErr;
        if (cancelledRef.current) return;
        setStatus({ ok: false, error: errBody.error ?? 'fetch_failed', reason: errBody.reason ?? 'http_' + res.status });
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
    <div className="agentforge-cui__eval-badge-wrap" data-testid="eval-gate-badge">
      <button
        type="button"
        onClick={() => setExpanded((s) => !s)}
        data-testid="eval-gate-badge-toggle"
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
      {expanded && variant === 'green' && status !== null && (status as EvalStatusOk).ok === true ? (
        <EvalGateDetailPanel status={status as EvalStatusOk} />
      ) : null}
      {expanded && variant === 'red' && (status as EvalStatusOk).ok === true ? (
        <EvalGateDetailPanel status={status as EvalStatusOk} />
      ) : null}
      {expanded && variant === 'unknown' ? (
        <div data-testid="eval-gate-badge-unknown" className="agentforge-cui__eval-badge-detail" style={DETAIL_STYLE}>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#666' }}>
            No eval report available yet — run <code>npm run eval</code> from <code>agentforge/api/</code>.
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
  minWidth: 240,
  boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
  fontSize: '0.8rem',
  zIndex: 10,
};

function EvalGateDetailPanel(props: { readonly status: EvalStatusOk }): ReactElement {
  const { status } = props;
  const cats = Object.entries(status.per_category);
  return (
    <div data-testid="eval-gate-badge-detail" className="agentforge-cui__eval-badge-detail" style={DETAIL_STYLE}>
      <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>
        Eval gate {status.cases_failed === 0 ? '✓' : '✗'} — {status.cases_total - status.cases_failed}/{status.cases_total} cases
      </p>
      <table style={{ width: '100%', fontSize: '0.75rem', borderCollapse: 'collapse' }}>
        <tbody>
          {cats.map(([cat, v]) => (
            <tr key={cat}>
              <td style={{ padding: '2px 0', color: '#444' }}>{cat}</td>
              <td style={{ padding: '2px 0', textAlign: 'right', color: v.pass_rate >= 0.95 ? '#1d8348' : '#c0392b' }}>
                {(v.pass_rate * 100).toFixed(0)}% ({v.case_count})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.7rem', color: '#888' }}>
        baseline {status.baseline_version ?? 'n/a'} · breaches {status.gate_breaches_count}
      </p>
    </div>
  );
}

function pickVariant(status: EvalStatusFetched): 'green' | 'red' | 'unknown' {
  if ('state' in status && status.state === 'unknown') return 'unknown';
  if ('ok' in status && status.ok === true) {
    if (status.cases_failed === 0 && status.gate_breaches_count === 0) return 'green';
    return 'red';
  }
  return 'unknown';
}

function pickLabel(status: EvalStatusFetched): string {
  if ('state' in status && status.state === 'unknown') return 'Eval ?';
  if ('ok' in status && status.ok === true) {
    return `Eval ${status.cases_total - status.cases_failed}/${status.cases_total}`;
  }
  return 'Eval ?';
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
