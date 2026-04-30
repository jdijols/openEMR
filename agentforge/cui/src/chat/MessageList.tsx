import type { ReactElement } from 'react';
import type { ChatBlock } from '../types/chat.js';

export type ChatMessage = { role: 'user' | 'assistant'; blocks: ChatBlock[] };

function renderBlock(block: ChatBlock, key: string): ReactElement {
  switch (block.type) {
    case 'text':
      return (
        <p key={key} className="agentforge-msg__text">
          {block.text}
        </p>
      );
    case 'claim': {
      const cite =
        block.citation_ids !== undefined && block.citation_ids.length > 0
          ? ` (${block.citation_ids.join(', ')})`
          : '';
      return (
        <p key={key} className="agentforge-msg__claim">
          <strong>Claim:</strong> {block.text}
          {cite}
        </p>
      );
    }
    default:
      return (
        <p key={key} className="agentforge-msg__unknown">
          (Unsupported block)
        </p>
      );
  }
}

export function MessageList(props: { readonly messages: readonly ChatMessage[] }): ReactElement {
  return (
    <div className="agentforge-messages" aria-live="polite">
      {props.messages.map((m, i) => (
        <article
          key={i}
          className={`agentforge-msg agentforge-msg--${m.role}`}
          aria-label={m.role === 'user' ? 'You' : 'Assistant'}
        >
          {m.blocks.map((b, j) => renderBlock(b, `${i}-${j}`))}
        </article>
      ))}
    </div>
  );
}
