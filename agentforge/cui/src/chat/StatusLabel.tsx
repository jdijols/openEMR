import type { ReactElement } from 'react';

/**
 * Live "the assistant is doing something" affordance — a single pill that
 * goes up the moment work begins and *expands* to communicate WHICH thing
 * the moment the supervisor's routing decision lands.
 *
 * Two states, one DOM node:
 *
 *   • No label  → bare ellipsis dots. Renders the instant `sending` flips
 *     true, before the supervisor has chosen a worker (or for plain Q&A
 *     turns where it never will).
 *   • With label → sparkle + label text + dots, e.g. "Reading file ⋯".
 *     The leading sparkle/text fade+slide in from the left when the SSE
 *     `routing` event arrives, so the pill *grows* in place rather than
 *     two pills swapping. One ARIA live region reads the transition as
 *     a single status change.
 *
 * Used in three places — chat routing (worker calls), the brief auto-
 * trigger ("Generating summary"), and any future state that wants the
 * same "AI is doing X" design language. Mirrors Claude's "Reading file" /
 * "Editing" pattern: verb plus the concrete object on a continuously
 * visible pill.
 *
 * The sparkle icon is the two-4-pointed-sparkles AI mark from the
 * OpenEMR top-bar toggle (`header_icon.html.twig`). Reusing the glyph
 * here keeps the AI affordance visually stitched between the host
 * chrome's open/close button and the rail's inline indicators.
 */
export function StatusLabel(props: { readonly label?: string | null }): ReactElement {
  const showLabel = typeof props.label === 'string' && props.label !== '';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="status-label"
      data-has-label={showLabel ? 'true' : 'false'}
      className="agentforge-cui__status-label"
    >
      {showLabel ? (
        <span className="agentforge-cui__status-label-leading">
          <SparkleIcon />
          <span className="agentforge-cui__status-label-text">{props.label}</span>
        </span>
      ) : (
        <span className="agentforge-cui__status-label-sr-only">Clinical Copilot is typing</span>
      )}
      <span className="agentforge-cui__status-label-dots" aria-hidden="true">
        <span className="agentforge-cui__status-label-dot" />
        <span className="agentforge-cui__status-label-dot" />
        <span className="agentforge-cui__status-label-dot" />
      </span>
    </div>
  );
}

/**
 * Two 4-pointed sparkles — de-facto "AI" mark (Gemini, Copilot, Notion
 * AI). Lifted verbatim from `header_icon.html.twig` so the rail and the
 * host chrome share one glyph. Stroked with `currentColor` so it inherits
 * whatever text color surrounds it.
 */
function SparkleIcon(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="agentforge-cui__status-label-icon"
    >
      <path d="M10 7 Q 10 13 16 13 Q 10 13 10 19 Q 10 13 4 13 Q 10 13 10 7 Z" />
      <path d="M18 3 Q 18 6 21 6 Q 18 6 18 9 Q 18 6 15 6 Q 18 6 18 3 Z" />
    </svg>
  );
}
