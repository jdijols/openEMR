import type { ReactElement } from 'react';

/**
 * §9 / G2-MVP-67 — animated three-dot typing indicator. Mounts on user-send,
 * unmounts on first agent token (parent controls the `visible` prop).
 */
export function TypingIndicator(props: { readonly visible: boolean }): ReactElement | null {
  if (!props.visible) {
    return null;
  }
  return (
    <div role="status" aria-live="polite" data-testid="typing-indicator" className="agentforge-cui__typing">
      <span className="agentforge-cui__typing-dot" />
      <span className="agentforge-cui__typing-dot" />
      <span className="agentforge-cui__typing-dot" />
      <span className="agentforge-cui__typing-sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
        Clinical Copilot is typing
      </span>
    </div>
  );
}
