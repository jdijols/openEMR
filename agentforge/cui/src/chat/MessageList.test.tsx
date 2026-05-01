/**
 * G2-10 — MessageList renderer.
 *
 * Verifies text/claim block rendering and the absence of any HTML injection
 * surface. ESLint rule against `dangerouslySetInnerHTML` is enforced separately
 * by `eslint.config.js`; here we double-check at render time.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageList, type ChatMessage } from './MessageList.js';

describe('MessageList (PRD §6.3 / G2-10)', () => {
  it('renders text blocks for user and assistant roles', () => {
    const messages: ChatMessage[] = [
      { role: 'user', blocks: [{ type: 'text', text: 'list allergies' }] },
      { role: 'assistant', blocks: [{ type: 'text', text: 'No allergies on file.' }] },
    ];
    render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(screen.getByText('list allergies')).toBeInTheDocument();
    expect(screen.getByText('No allergies on file.')).toBeInTheDocument();
    expect(screen.getByLabelText('You')).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant')).toBeInTheDocument();
  });

  it('renders claim with inline link on claim text when a single citation is present (no trailing UUID list)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'claim',
            text: 'Patient has no documented allergies.',
            citation_ids: ['sp-1'],
          },
        ],
        citation_navigation: { 'sp-1': { kind: 'allergy', params: {} } },
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid="p1" />);
    expect(container.textContent ?? '').not.toMatch(/Claim:/);
    expect(screen.getByRole('button', { name: 'Patient has no documented allergies.' })).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/sp-1/);
  });

  it('renders segmented claim with cite labels as buttons, not raw UUIDs', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'claim',
            segments: [
              { type: 'text', text: 'Allergic to ' },
              { type: 'cite', text: 'lisinopril', citation_id: 'uuid-a' },
              { type: 'text', text: ' (cough).' },
            ],
          },
        ],
        citation_navigation: { 'uuid-a': { kind: 'allergy', params: {} } },
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid="p1" />);
    expect(screen.getByRole('button', { name: 'lisinopril' })).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/uuid-a/);
  });

  it('renders legacy multi-citation claims as plain prose (no trailing ID list)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'claim',
            text: 'Two facts in one line.',
            citation_ids: ['sp-1', 'sp-2'],
          },
        ],
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.textContent ?? '').not.toMatch(/Claim:/);
    expect(screen.getByText(/Two facts in one line\./)).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/sp-1/);
    expect(container.textContent ?? '').not.toMatch(/sp-2/);
  });

  it('renders a claim block without citations cleanly (no trailing parens)', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'claim', text: 'A statement.' }] },
    ];
    render(<MessageList messages={messages} boundPatientUuid={null} />);
    const node = screen.getByText(/A statement\./);
    expect(node.textContent ?? '').not.toMatch(/\(\)/);
  });

  it('strips leading One-liner: from assistant text blocks only', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: 'One-liner: 78-year-old male.' }] },
      { role: 'user', blocks: [{ type: 'text', text: 'One-liner: user typed this.' }] },
    ];
    render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(screen.getByText('78-year-old male.')).toBeInTheDocument();
    expect(screen.getByText('One-liner: user typed this.')).toBeInTheDocument();
  });

  it('escapes content (no raw HTML injection through text blocks)', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('MessageList — dictation badge', () => {
  it('renders a "Dictation" badge on user messages with source=dictation', () => {
    const messages: ChatMessage[] = [
      { role: 'user', blocks: [{ type: 'text', text: 'BP 125 over 60' }], source: 'dictation' },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(screen.getByText('Dictation')).toBeInTheDocument();
    // Text content is clean — no "[dictation] " prefix leaks into the rendered bubble.
    expect(screen.getByText('BP 125 over 60')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/\[dictation\]/);
    expect(screen.getByLabelText('You (dictation)')).toBeInTheDocument();
  });

  it('does not render a "Dictation" badge on typed user messages', () => {
    const messages: ChatMessage[] = [
      { role: 'user', blocks: [{ type: 'text', text: 'BP 125 over 60' }] },
    ];
    render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(screen.queryByText('Dictation')).not.toBeInTheDocument();
    expect(screen.getByLabelText('You')).toBeInTheDocument();
  });
});

describe('MessageList (Gate 3 / PRD §6.3)', () => {
  it('renders warning, refusal, and collapsible tool blocks', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          { type: 'warning', text: 'Med status conflict detected.' },
          { type: 'refusal', reason: 'blocked_cross_patient_tool_args' },
          { type: 'tool_call', name: 'get_allergies', detail: '{}' },
          { type: 'tool_result', tool: 'get_allergies', detail: '{}' },
        ],
      },
    ];
    render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(screen.getByText(/Med status conflict/)).toBeInTheDocument();
    expect(screen.getByText(/blocked_cross_patient_tool_args/)).toBeInTheDocument();
    expect(screen.getByText(/^Tool:/)).toBeInTheDocument();
    expect(screen.getByText(/^Result:/)).toBeInTheDocument();
  });
});
