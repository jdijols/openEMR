/**
 * Assistant prose Markdown renderer.
 *
 * Why this exists:
 *   The model habitually emits Markdown (`**bold**`, `### Headings`, `- bullets`)
 *   in `text` blocks and in claim text segments. Until now those characters were
 *   rendered as literal punctuation, which read as noise to a busy clinician.
 *   This component is the single place the rail turns Markdown source into
 *   readable structure (headings, bold, lists, code), with a strict allow-list
 *   so the model can never inject `<script>`, `<iframe>`, `<img onerror=…>`,
 *   `javascript:` URLs, or other unsafe HTML.
 *
 * Two modes:
 *   - Block (default): wraps in a `<div>` and lets headings/lists/code render
 *     as their natural block elements. Used for top-level assistant `text`
 *     blocks (chat turns + the auto-brief).
 *   - Inline: wraps in a `<span>` and unwraps all block-level Markdown so the
 *     output is safe to drop inside an existing `<p>` or `<button>` (claim
 *     text segments, warning text, citation labels). Block constructs (tables,
 *     headings, lists, paragraphs) degrade to their inline text content.
 *
 * The sanitize schema is GitHub's defaults minus a handful of tags we have no
 * reason to render (img, picture, source, input, details, summary, section,
 * div). rehype-sanitize already strips raw `<script>` and disallows unsafe URL
 * protocols; this just narrows the surface further.
 */

import type { ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { Schema } from 'hast-util-sanitize';

/* ── Sanitize schemas ───────────────────────────────────────────────────
 * Both block and inline modes start from `defaultSchema` (GitHub-style) and
 * narrow `tagNames`. Everything else (URL protocol allow-list, attribute
 * allow-list, clobber prefix) inherits the GitHub defaults — those are the
 * pieces that block `javascript:` hrefs and `<img onerror=…>` attribute
 * injection, and we want them as-is.
 */

const STRIPPED_BLOCK_TAGS = new Set([
  'img',
  'picture',
  'source',
  'input',
  'details',
  'summary',
  'section',
  'div',
]);

const blockSchema: Schema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((t) => !STRIPPED_BLOCK_TAGS.has(t)),
};

/**
 * Inline mode keeps only inline phrasing tags. Block-level Markdown
 * (headings, lists, tables, paragraphs) gets unwrapped via
 * `disallowedElements` + `unwrapDisallowed` below — the children survive,
 * the wrapping element does not.
 */
const inlineSchema: Schema = {
  ...defaultSchema,
  tagNames: ['a', 'br', 'code', 'del', 'em', 'i', 'kbd', 's', 'span', 'strong', 'sub', 'sup'],
};

/* Block elements that must NOT appear when rendering inside an existing
 * `<p>` or `<button>`. `unwrapDisallowed: true` replaces each with its
 * children, preserving the text content. */
const INLINE_DISALLOWED: ReadonlyArray<string> = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

/* ── Component overrides ────────────────────────────────────────────────
 * Reasons we override these:
 *   - h1/h2: the panel iframe is narrow and the rail's outer chrome already
 *     owns the largest type. Demote h1→h3 and h2→h4 so a model-emitted
 *     `# Title` never out-shouts the panel header.
 *   - a: every assistant-emitted link opens in a new tab. The rail iframe is
 *     sandboxed and we don't want a user click navigating the iframe out of
 *     the OpenEMR shell. `noopener noreferrer` blocks tab-nabbing and
 *     prevents leaking the rail URL via Referer.
 */
const blockComponents: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export default function AssistantMarkdown(props: {
  readonly text: string;
  readonly inline?: boolean;
}): ReactElement {
  const inline = props.inline === true;
  const Wrapper = inline ? 'span' : 'div';
  const className =
    inline ? 'agentforge-msg__md agentforge-msg__md--inline' : 'agentforge-msg__md';
  const schema = inline ? inlineSchema : blockSchema;

  return (
    <Wrapper className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={blockComponents}
        {...(inline ?
          {
            disallowedElements: INLINE_DISALLOWED,
            unwrapDisallowed: true,
          }
        : {})}
      >
        {props.text}
      </ReactMarkdown>
    </Wrapper>
  );
}
