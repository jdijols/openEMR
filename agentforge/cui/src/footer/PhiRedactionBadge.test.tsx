import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PhiRedactionBadge } from './PhiRedactionBadge.js';

const ALL_CAUGHT = {
  ok: true,
  input_sample: 'Patient name: JOHN DOE, DOB 1980-01-15, SSN 555-12-3456, phone 555-867-5309',
  redacted_sample: 'Patient name: [REDACTED], DOB [REDACTED], SSN [REDACTED], phone [REDACTED]',
  patterns_tested: ['ssn', 'dob_iso', 'phone_us', 'email', 'mrn_label', 'person_name'],
  patterns_caught: ['ssn', 'dob_iso', 'phone_us', 'email', 'mrn_label', 'person_name'],
  patterns_missed: [],
  all_caught: true,
};

const ONE_MISSED = {
  ...ALL_CAUGHT,
  patterns_caught: ALL_CAUGHT.patterns_tested.slice(0, 5),
  patterns_missed: ['email'],
  all_caught: false,
  redacted_sample: 'Patient name: [REDACTED], DOB [REDACTED], SSN [REDACTED], john.doe@example.com',
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

describe('PhiRedactionBadge (FB-A-06)', () => {
  it('renders green pill when every pattern is caught', async () => {
    render(<PhiRedactionBadge apiBase="https://api.example" fetchImpl={fakeFetch(ALL_CAUGHT)} />);
    await waitFor(() => {
      const toggle = screen.getByTestId('phi-redaction-badge-toggle');
      expect(toggle).toHaveAttribute('data-variant', 'green');
      expect(toggle).toHaveTextContent('PHI ✓ 6/6');
    });
  });

  it('renders red pill when at least one pattern is missed', async () => {
    render(<PhiRedactionBadge apiBase="https://api.example" fetchImpl={fakeFetch(ONE_MISSED)} />);
    await waitFor(() => {
      const toggle = screen.getByTestId('phi-redaction-badge-toggle');
      expect(toggle).toHaveAttribute('data-variant', 'red');
      expect(toggle).toHaveTextContent('PHI ✗ 5/6');
    });
  });

  it('renders unknown pill when fetch throws', async () => {
    render(
      <PhiRedactionBadge
        apiBase="https://api.example"
        fetchImpl={vi.fn(() => Promise.reject(new Error('network down')))}
      />,
    );
    await waitFor(() => {
      const toggle = screen.getByTestId('phi-redaction-badge-toggle');
      expect(toggle).toHaveAttribute('data-variant', 'unknown');
      expect(toggle).toHaveTextContent('PHI ?');
    });
  });

  it('expands to side-by-side input vs redacted_sample on click', async () => {
    render(<PhiRedactionBadge apiBase="https://api.example" fetchImpl={fakeFetch(ALL_CAUGHT)} />);
    await waitFor(() => screen.getByTestId('phi-redaction-badge-toggle'));
    fireEvent.click(screen.getByTestId('phi-redaction-badge-toggle'));
    const detail = screen.getByTestId('phi-redaction-badge-detail');
    expect(detail).toHaveTextContent('All patterns caught');
    expect(detail).toHaveTextContent('JOHN DOE');
    expect(detail).toHaveTextContent('[REDACTED]');
    expect(detail).toHaveTextContent('6/6 patterns caught');
  });

  it('lists missed patterns in detail when one slips', async () => {
    render(<PhiRedactionBadge apiBase="https://api.example" fetchImpl={fakeFetch(ONE_MISSED)} />);
    await waitFor(() => screen.getByTestId('phi-redaction-badge-toggle'));
    fireEvent.click(screen.getByTestId('phi-redaction-badge-toggle'));
    const detail = screen.getByTestId('phi-redaction-badge-detail');
    expect(detail).toHaveTextContent('One or more patterns missed');
    expect(detail).toHaveTextContent('missed: email');
  });
});
