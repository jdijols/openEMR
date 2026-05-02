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

  it('strips raw HTML in assistant text blocks via rehype-sanitize (no img, no onerror)', () => {
    // Markdown rendering parses raw HTML in the source string. rehype-sanitize
    // then drops any tag not in the allow-list (img is removed) and any unsafe
    // attribute (onerror). The result: no <img> in the DOM, no `onerror`
    // attribute anywhere, and the dangerous source is not echoed back as
    // visible text either.
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/onerror/i);
    expect(container.innerHTML).not.toMatch(/alert\(1\)/);
  });

  it('keeps literal HTML in user bubbles as visible text (no Markdown parsing for user input)', () => {
    // Mirror of the assistant case: user bubbles render text literally so a
    // physician's typed `<` and `>` never get interpreted, and so a clinician
    // who paste-injects HTML can see exactly what they pasted.
    const messages: ChatMessage[] = [
      { role: 'user', blocks: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('MessageList — assistant Markdown rendering', () => {
  it('renders **bold** in assistant text blocks as <strong>', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: 'Use **lisinopril** with caution.' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('lisinopril');
    expect(container.textContent ?? '').not.toMatch(/\*\*/);
  });

  it('renders ### Interval in assistant text blocks as a (demoted) <h3>', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: '### Interval\n\nNo new complaints.' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    const heading = container.querySelector('h3');
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('Interval');
    expect(container.textContent ?? '').not.toMatch(/^###/m);
  });

  it('renders # Title (h1 from model) demoted to <h3> so it does not out-shout the panel chrome', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: '# Top of brief' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('h3')?.textContent).toBe('Top of brief');
  });

  it('renders - bullet lists in assistant text blocks as <ul><li>', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [{ type: 'text', text: '- BP elevated\n- A1c rising\n- Med adherence good' }],
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    const items = container.querySelectorAll('ul > li');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain('BP elevated');
  });

  it('does NOT render Markdown in user text blocks (literal asterisks survive)', () => {
    const messages: ChatMessage[] = [
      { role: 'user', blocks: [{ type: 'text', text: 'Patient said **really bad** pain.' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.querySelector('strong')).toBeNull();
    expect(screen.getByText(/\*\*really bad\*\*/)).toBeInTheDocument();
  });

  it('renders Markdown bold inside claim text segments without breaking citation buttons', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [
          {
            type: 'claim',
            segments: [
              { type: 'text', text: 'Patient takes **40 mg** of ' },
              { type: 'cite', text: 'lisinopril', citation_id: 'uuid-a' },
              { type: 'text', text: ' daily.' },
            ],
          },
        ],
        citation_navigation: { 'uuid-a': { kind: 'medication', params: {} } },
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid="p1" />);
    expect(screen.getByRole('button', { name: 'lisinopril' })).toBeInTheDocument();
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('40 mg');
  });

  it('renders Markdown bold inside warning blocks while keeping the Warning: chrome', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [{ type: 'warning', text: 'Possible **drug interaction** detected.' }],
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(screen.getByText('Warning:')).toBeInTheDocument();
    const strong = container.querySelector('.agentforge-msg__warning strong');
    // "Warning:" is the first <strong>; the Markdown-rendered "drug interaction"
    // is a second <strong>. Find it explicitly.
    const allStrong = container.querySelectorAll('.agentforge-msg__warning strong');
    expect(allStrong.length).toBeGreaterThanOrEqual(2);
    expect(strong?.textContent).toBe('Warning:');
    expect(allStrong[1]?.textContent).toBe('drug interaction');
  });

  it('strips javascript: URLs from Markdown links (rehype-sanitize URL allow-list)', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [{ type: 'text', text: 'Click [here](javascript:alert(1)) please.' }],
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    const link = container.querySelector('a');
    // react-markdown's defaultUrlTransform drops javascript: outright; the link
    // either has no href or an empty/safe one. Either way, no `javascript:`
    // string appears in the rendered HTML.
    expect(container.innerHTML).not.toMatch(/javascript:/i);
    if (link !== null) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    }
  });

  it('opens https links in a new tab with rel=noopener noreferrer', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        blocks: [{ type: 'text', text: 'See [reference](https://example.com/doc).' }],
      },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://example.com/doc');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toMatch(/noopener/);
    expect(link?.getAttribute('rel')).toMatch(/noreferrer/);
  });

  it('still strips legacy "One-liner:" prefix from assistant text blocks before Markdown', () => {
    const messages: ChatMessage[] = [
      { role: 'assistant', blocks: [{ type: 'text', text: 'One-liner: 78-year-old male.' }] },
    ];
    const { container } = render(<MessageList messages={messages} boundPatientUuid={null} />);
    expect(container.textContent).toContain('78-year-old male.');
    expect(container.textContent ?? '').not.toMatch(/One-liner:/);
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

describe('MessageList — auto-scroll to newest turn', () => {
  /**
   * Regression: the chat feed must pin to the bottom whenever a new message
   * lands so the operator does not have to manually scroll for every turn.
   * jsdom does not actually compute layout, so we stub `scrollHeight` (the
   * sentinel value the auto-scroll effect reads) and assert that
   * `scrollTop` is bumped to match it after the messages prop changes.
   */
  it('sets scrollTop to scrollHeight when a new message is appended', () => {
    const initial: ChatMessage[] = [
      { role: 'user', blocks: [{ type: 'text', text: 'first' }] },
    ];
    const { container, rerender } = render(
      <MessageList messages={initial} boundPatientUuid={null} />,
    );
    const feed = container.querySelector('.agentforge-messages') as HTMLElement;
    expect(feed).not.toBeNull();

    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 4242 });
    feed.scrollTop = 0;

    const next: ChatMessage[] = [
      ...initial,
      { role: 'assistant', blocks: [{ type: 'text', text: 'second' }] },
    ];
    rerender(<MessageList messages={next} boundPatientUuid={null} />);

    expect(feed.scrollTop).toBe(4242);
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
