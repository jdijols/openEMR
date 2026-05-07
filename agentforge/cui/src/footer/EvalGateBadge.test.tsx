import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EvalGateBadge } from './EvalGateBadge.js';

const HEALTHY = {
  ok: true,
  run_id: '20260507T073700037Z_fa21ce79',
  ran_at: '2026-05-07T07:37:00.037Z',
  cases_total: 75,
  cases_failed: 0,
  perf_over_budget: false,
  baseline_version: 'w2-final-rebalance-2026-05-06',
  gate_breaches_count: 0,
  per_category: {
    schema_valid: { pass_rate: 1.0, case_count: 10 },
    citation_present: { pass_rate: 1.0, case_count: 10 },
    factually_consistent: { pass_rate: 1.0, case_count: 12 },
    safe_refusal: { pass_rate: 1.0, case_count: 35 },
    no_phi_in_logs: { pass_rate: 1.0, case_count: 8 },
  },
};

const REGRESSED = {
  ...HEALTHY,
  cases_failed: 3,
  gate_breaches_count: 1,
  per_category: { ...HEALTHY.per_category, citation_present: { pass_rate: 0.7, case_count: 10 } },
};

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return vi.fn(() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response),
  );
}

describe('EvalGateBadge (FB-A-05)', () => {
  it('renders green pill when healthy', async () => {
    render(<EvalGateBadge apiBase="https://api.example" fetchImpl={fakeFetch(HEALTHY)} />);
    await waitFor(() => {
      const toggle = screen.getByTestId('eval-gate-badge-toggle');
      expect(toggle).toHaveAttribute('data-variant', 'green');
      expect(toggle).toHaveTextContent('Eval 75/75');
    });
  });

  it('renders red pill on regression', async () => {
    render(<EvalGateBadge apiBase="https://api.example" fetchImpl={fakeFetch(REGRESSED)} />);
    await waitFor(() => {
      const toggle = screen.getByTestId('eval-gate-badge-toggle');
      expect(toggle).toHaveAttribute('data-variant', 'red');
      expect(toggle).toHaveTextContent('Eval 72/75');
    });
  });

  it('renders unknown pill when endpoint 503s', async () => {
    render(
      <EvalGateBadge
        apiBase="https://api.example"
        fetchImpl={fakeFetch({ ok: false, error: 'eval_unavailable', reason: 'no_reports_found' }, 503)}
      />,
    );
    await waitFor(() => {
      const toggle = screen.getByTestId('eval-gate-badge-toggle');
      expect(toggle).toHaveAttribute('data-variant', 'unknown');
      expect(toggle).toHaveTextContent('Eval ?');
    });
  });

  it('expands to per-category detail on click when healthy', async () => {
    render(<EvalGateBadge apiBase="https://api.example" fetchImpl={fakeFetch(HEALTHY)} />);
    await waitFor(() => screen.getByTestId('eval-gate-badge-toggle'));
    fireEvent.click(screen.getByTestId('eval-gate-badge-toggle'));
    const detail = screen.getByTestId('eval-gate-badge-detail');
    expect(detail).toHaveTextContent('schema_valid');
    expect(detail).toHaveTextContent('100%');
    expect(detail).toHaveTextContent('safe_refusal');
    expect(detail).toHaveTextContent('w2-final-rebalance-2026-05-06');
  });

  it('renders fallback panel when unknown variant is expanded', async () => {
    render(
      <EvalGateBadge
        apiBase="https://api.example"
        fetchImpl={vi.fn(() => Promise.reject(new Error('network down')))}
      />,
    );
    await waitFor(() => screen.getByTestId('eval-gate-badge-toggle'));
    fireEvent.click(screen.getByTestId('eval-gate-badge-toggle'));
    expect(screen.getByTestId('eval-gate-badge-unknown')).toBeInTheDocument();
  });
});
