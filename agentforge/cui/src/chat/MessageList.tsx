import type { ReactElement } from 'react';
import { useLayoutEffect, useState } from 'react';
import { postProposalConfirm, postProposalReject } from '../api/client.js';
import type { ChatBlock, ChatMessage, CitationNavigationHint } from '../types/chat.js';

/** OpenEMR / Agent API wiring for clinician confirm decisions (assistant proposal blocks only). */
export type ProposalApiEnv = Readonly<{
  apiBase: string;
  sessionToken: string;
  patientUuid: string;
  conversationId: string;
}>;

function requestCitationNavigation(
  citeId: string,
  hint: CitationNavigationHint,
  expectedPatientUuid: string,
): void {
  if (typeof window.parent === 'undefined' || window.parent === null) {
    return;
  }

  window.parent.postMessage(
    {
      type: 'NAV_REQUEST',
      hint: { kind: hint.kind, params: { ...hint.params } },
      expected_patient_uuid: expectedPatientUuid,
    },
    window.location.origin,
  );
}

/** Strip legacy case-presentation header the model was asked to emit; UI does not show this label. */
function displayAssistantText(text: string): string {
  return text.replace(/^\s*One-liner:\s*/i, '');
}

type ProposalPhase = Readonly<{
  phase: 'idle' | 'submitting' | 'accepted' | 'declined' | 'openemr_denied';
  openemrReason?: string | undefined;
}>;

function ProposalBlock(
  props: Readonly<{
    block: ProposalBlockInner;
    proposalEnv?: ProposalApiEnv;
    voiceCompletedProposalIds?: ReadonlySet<string>;
  }>,
): ReactElement {
  const { proposalEnv } = props;
  const voiceDone = props.voiceCompletedProposalIds?.has(props.block.proposal_id) === true;

  const [ui, setUi] = useState<ProposalPhase>({ phase: 'idle' });

  const canInteract = proposalEnv !== undefined && ui.phase === 'idle' && !voiceDone;
  const showDecisionButtons =
    !voiceDone && (ui.phase === 'idle' || ui.phase === 'submitting');

  function statusText(): string {
    if (voiceDone) {
      return 'Accepted (voice).';
    }
    if (ui.phase === 'submitting') return 'Submitting…';
    if (ui.phase === 'accepted') return 'Accepted.';
    if (ui.phase === 'declined') return 'Declined.';
    if (ui.phase === 'openemr_denied') {
      return ui.openemrReason !== undefined && ui.openemrReason.trim() !== '' ?
          `Rejected by OpenEMR: ${ui.openemrReason}`
        : 'Rejected by OpenEMR.';
    }
    return '';
  }

  async function onConfirm(): Promise<void> {
    if (proposalEnv === undefined || ui.phase !== 'idle') return;
    const env = proposalEnv;
    const proposalId = props.block.proposal_id;

    setUi({ phase: 'submitting' });
    try {
      const outcome = await postProposalConfirm(env.apiBase, env.sessionToken, env.patientUuid, env.conversationId, proposalId);
      if (outcome.accepted) {
        setUi({ phase: 'accepted' });
      } else {
        setUi({ phase: 'openemr_denied', openemrReason: outcome.reason });
      }
    } catch {
      setUi({ phase: 'openemr_denied', openemrReason: 'Request failed.' });
    }
  }

  async function onReject(): Promise<void> {
    if (proposalEnv === undefined || ui.phase !== 'idle') return;
    const env = proposalEnv;
    const proposalId = props.block.proposal_id;

    setUi({ phase: 'submitting' });
    try {
      await postProposalReject(env.apiBase, env.sessionToken, env.patientUuid, env.conversationId, proposalId);
      setUi({ phase: 'declined' });
    } catch {
      setUi({ phase: 'openemr_denied', openemrReason: 'Decline failed.' });
    }
  }

  return (
    <div className="agentforge-msg__proposal-card" aria-label={`Proposed ${props.block.write_target}`}>
      <p className="agentforge-msg__proposal-label">{`Proposed (${props.block.write_target})`}</p>
      <p className="agentforge-msg__proposal-preview">{props.block.preview}</p>

      {statusText() !== '' ?
        <p className="agentforge-msg__proposal-status" role="status">
          {statusText()}
        </p>
      : null}

      {showDecisionButtons ?
        <div className="agentforge-msg__proposal-actions">
          <button
            type="button"
            className="agentforge-msg__proposal-btn agentforge-msg__proposal-btn--primary"
            onClick={() => void onConfirm()}
            disabled={!canInteract}
          >
            Confirm
          </button>
          <button
            type="button"
            className="agentforge-msg__proposal-btn agentforge-msg__proposal-btn--secondary"
            onClick={() => void onReject()}
            disabled={!canInteract}
          >
            Reject
          </button>
        </div>
      : null}

      {proposalEnv === undefined ?
        <p className="agentforge-msg__proposal-hint">Thread not ready — send a chart message after opening the Assistant.</p>
      : null}
    </div>
  );
}

type ProposalBlockInner = Extract<ChatBlock, { type: 'proposal' }>;

function renderBlock(
  block: ChatBlock,
  key: string,
  opts: {
    readonly citationNav?: Readonly<Record<string, CitationNavigationHint>>;
    readonly boundPatientUuid: string | null;
    readonly assistantMessage?: boolean;
    readonly proposalEnv?: ProposalApiEnv;
    readonly voiceCompletedProposalIds?: ReadonlySet<string>;
  },
): ReactElement {
  switch (block.type) {
    case 'proposal':
      return opts.assistantMessage === true && opts.proposalEnv !== undefined ?
        <ProposalBlock
          key={key}
          block={block}
          proposalEnv={opts.proposalEnv}
          {...(opts.voiceCompletedProposalIds !== undefined ?
            { voiceCompletedProposalIds: opts.voiceCompletedProposalIds }
          : {})}
        />
      : (
          <ProposalBlock
            key={key}
            block={block}
            {...(opts.voiceCompletedProposalIds !== undefined ?
              { voiceCompletedProposalIds: opts.voiceCompletedProposalIds }
            : {})}
          />
        );
    case 'text':
      return (
        <p key={key} className="agentforge-msg__text">
          {opts.assistantMessage === true ? displayAssistantText(block.text) : block.text}
        </p>
      );
    case 'claim': {
      const nav = opts.citationNav;
      const bound = opts.boundPatientUuid ?? '';
      const segments = block.segments;

      if (segments !== undefined && segments.length > 0) {
        return (
          <p key={key} className="agentforge-msg__claim">
            {segments.map((seg, i) => {
              if (seg.type === 'text') {
                const t = opts.assistantMessage === true ? displayAssistantText(seg.text) : seg.text;
                return <span key={i}>{t}</span>;
              }

              const hint = nav?.[seg.citation_id];
              const canNav = hint !== undefined && bound !== '';

              if (canNav) {
                return (
                  <button
                    key={i}
                    type="button"
                    className="agentforge-msg__cite-link"
                    onClick={() => requestCitationNavigation(seg.citation_id, hint, bound)}
                  >
                    {seg.text}
                  </button>
                );
              }

              return (
                <span key={i} className="agentforge-msg__cite-fallback">
                  {seg.text}
                </span>
              );
            })}
          </p>
        );
      }

      const citeIds = block.citation_ids ?? [];
      const rawText = block.text ?? '';
      const text = opts.assistantMessage === true ? displayAssistantText(rawText) : rawText;

      if (citeIds.length === 1) {
        const citeId = citeIds[0]!;
        const hint = nav?.[citeId];
        const canNav = hint !== undefined && bound !== '';

        return (
          <p key={key} className="agentforge-msg__claim">
            {canNav ? (
              <button
                type="button"
                className="agentforge-msg__cite-link"
                onClick={() => requestCitationNavigation(citeId, hint, bound)}
              >
                {text}
              </button>
            ) : (
              text
            )}
          </p>
        );
      }

      return (
        <p key={key} className="agentforge-msg__claim">
          {text}
        </p>
      );
    }
    case 'warning':
      return (
        <p key={key} className="agentforge-msg__warning" role="status">
          <strong>Warning:</strong> {block.text}
        </p>
      );
    case 'refusal':
      return (
        <p key={key} className="agentforge-msg__refusal" role="alert">
          <strong>Refusal:</strong> {block.reason}
        </p>
      );
    case 'tool_call':
      return (
        <details key={key} className="agentforge-msg__tool agentforge-msg__tool--call small text-muted">
          <summary>Tool: {block.name}</summary>
          {block.detail !== undefined && block.detail !== '' ? <pre className="mb-0 mt-1">{block.detail}</pre> : null}
        </details>
      );
    case 'tool_result':
      return (
        <details key={key} className="agentforge-msg__tool agentforge-msg__tool--result small text-muted">
          <summary>Result: {block.tool}</summary>
          {block.detail !== undefined && block.detail !== '' ? <pre className="mb-0 mt-1">{block.detail}</pre> : null}
        </details>
      );
    case 'recap': {
      return (
        <div key={key} className="agentforge-msg__recap" role="region" aria-label="Visit capture recap">
          <p className="agentforge-msg__recap-title">
            <strong>What we captured</strong>
          </p>
          <ul className="agentforge-msg__recap-list">
            {block.items.map((it) => (
              <li
                key={it.id}
                className={`agentforge-msg__recap-item agentforge-msg__recap-item--${it.classification}`}
              >
                <span className="agentforge-msg__recap-badge">{it.classification}</span>
                {it.write_target !== undefined && it.write_target !== '' ?
                  <span className="agentforge-msg__recap-target">{it.write_target}</span>
                : null}
                <span className="agentforge-msg__recap-summary">{it.summary}</span>
              </li>
            ))}
          </ul>
        </div>
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

export type { ChatMessage } from '../types/chat.js';

export function MessageList(props: {
  readonly messages: readonly ChatMessage[];
  readonly boundPatientUuid: string | null;
  readonly proposalEnv?: ProposalApiEnv;
  readonly voiceCompletedProposalIds?: ReadonlySet<string>;
}): ReactElement {
  const [notice, setNotice] = useState<string | null>(null);

  useLayoutEffect(() => {
    function onHostMessage(ev: MessageEvent): void {
      if (
        ev.origin !== window.location.origin &&
        ev.origin !== '' /* same-document/jsdom synthesizes empty origin */
      ) {
        return;
      }
      if (typeof ev.data !== 'object' || ev.data === null) {
        return;
      }

      const t = (ev.data as { type?: unknown }).type;
      if (t === 'NAV_REFUSED') {
        setNotice('Active chart changed; please retry');
        return;
      }

      if (t === 'NAV_LIMITED') {
        setNotice('Limited navigation available for this source');
      }
    }

    window.addEventListener('message', onHostMessage);
    return () => window.removeEventListener('message', onHostMessage);
  }, []);

  return (
    <div className="agentforge-messages" aria-live="polite">
      {notice !== null ? (
        <p className="agentforge-msg__nav-notice" role="status">
          {notice}
        </p>
      ) : null}
      {props.messages.map((m, i) => {
        const isDictation = m.role === 'user' && m.source === 'dictation';
        return (
          <article
            key={i}
            className={`agentforge-msg agentforge-msg--${m.role}${isDictation ? ' agentforge-msg--dictation' : ''}`}
            aria-label={m.role === 'user' ? (isDictation ? 'You (dictation)' : 'You') : 'Assistant'}
          >
            {isDictation ? (
              <span className="agentforge-msg__dictation-badge" aria-label="Dictated">
                Dictation
              </span>
            ) : null}
            {m.blocks.map((b, j) =>
              renderBlock(b, `${i}-${j}`, {
                assistantMessage: m.role === 'assistant',
                boundPatientUuid: props.boundPatientUuid,
                ...(props.proposalEnv !== undefined && m.role === 'assistant' ? { proposalEnv: props.proposalEnv } : {}),
                ...(props.voiceCompletedProposalIds !== undefined ?
                  { voiceCompletedProposalIds: props.voiceCompletedProposalIds }
                : {}),
                ...(m.role === 'assistant' && m.citation_navigation !== undefined ?
                  { citationNav: m.citation_navigation }
                : {}),
              }),
            )}
          </article>
        );
      })}
    </div>
  );
}
