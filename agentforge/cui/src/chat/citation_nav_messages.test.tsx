/**
 * Gate G3-10 — PRD §6.7.3 citation navigation triggers (happy path + CUI UX on host replies).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MessageList, type ChatMessage } from './MessageList.js';

describe('Citation navigation messages (Gate 3 / §6.7.3)', () => {
  let postSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    postSpy = vi.fn();
    Object.defineProperty(window, 'parent', { value: { postMessage: postSpy }, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
    vi.restoreAllMocks();
  });

  it('encounter happy path sends NAV_REQUEST to parent with hint + expected UUID', () => {
    const citeId = 'eu-uuid-click';
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [{ type: 'claim', text: 'Seen last visit.', citation_ids: [citeId] }],
        citation_navigation: {
          [citeId]: { kind: 'encounter', params: { encounter_id: 42 } },
        },
      },
    ];

    render(<MessageList messages={messages} boundPatientUuid="patient-abc" />);
    fireEvent.click(screen.getByRole('button', { name: 'Seen last visit.' }));

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]?.[0]).toEqual({
      type: 'NAV_REQUEST',
      hint: { kind: 'encounter', params: { encounter_id: 42 } },
      expected_patient_uuid: 'patient-abc',
    });
    expect(postSpy.mock.calls[0]?.[1]).toBe(window.location.origin);
  });

  it('shows retry copy when host refuses navigation (race / chart mismatch)', async () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'claim', text: 'x.', citation_ids: ['x'] }] },
    ];
    render(<MessageList messages={messages} boundPatientUuid={'p'} />);

    window.postMessage({ type: 'NAV_REFUSED', reason: 'chart_mismatch' }, window.location.origin);

    await waitFor(() => {
      expect(screen.getByText(/Active chart changed/)).toBeInTheDocument();
    });
  });

  it('shows limited-navigation copy when host signals unsupported kind fallback', async () => {
    const messages: ChatMessage[] = [{ role: 'assistant', blocks: [{ type: 'text', text: 'ok' }] }];
    render(<MessageList messages={messages} boundPatientUuid={null} />);

    window.postMessage({ type: 'NAV_LIMITED' }, window.location.origin);

    await waitFor(() => {
      expect(screen.getByText(/Limited navigation available/)).toBeInTheDocument();
    });
  });
});
