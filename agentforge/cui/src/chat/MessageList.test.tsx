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
    render(<MessageList messages={messages} />);
    expect(screen.getByText('list allergies')).toBeInTheDocument();
    expect(screen.getByText('No allergies on file.')).toBeInTheDocument();
    expect(screen.getByLabelText('You')).toBeInTheDocument();
    expect(screen.getByLabelText('Assistant')).toBeInTheDocument();
  });

  it('renders claim blocks with a Claim: prefix and citation ids when present', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'claim',
            text: 'Patient has no documented allergies.',
            citation_ids: ['sp-1', 'sp-2'],
          },
        ],
      },
    ];
    render(<MessageList messages={messages} />);
    expect(screen.getByText(/^Claim:/)).toBeInTheDocument();
    expect(screen.getByText(/sp-1, sp-2/)).toBeInTheDocument();
  });

  it('renders a claim block without citations cleanly (no trailing parens)', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'claim', text: 'A statement.' }] },
    ];
    render(<MessageList messages={messages} />);
    const node = screen.getByText(/A statement\./);
    expect(node.textContent ?? '').not.toMatch(/\(\)/);
  });

  it('escapes content (no raw HTML injection through text blocks)', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ];
    const { container } = render(<MessageList messages={messages} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
