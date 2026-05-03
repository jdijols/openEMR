import type { ReactElement } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { AgentForgeDeliveryError, postProposalConfirm, postProposalReject } from '../api/client.js';
import type {
  ChatBlock,
  ChatMessage,
  CitationNavigationHint,
  ProposalResolution,
} from '../types/chat.js';
import AssistantMarkdown from './AssistantMarkdown.js';

/**
 * Format a confirm/reject failure for the rail. Surfaces the literal server
 * `error` string + a short correlation id so post-deploy bugs (e.g. P1
 * `duplicate_proposal`, `unauthenticated`, `missing_encounter_id`) are
 * self-diagnosing without a server log dive.
 */
function formatDeliveryFailure(verb: 'Confirm' | 'Decline' | 'Delete' | 'Cancel', err: unknown): string {
  if (err instanceof AgentForgeDeliveryError) {
    const code = err.serverError ?? err.kind;
    const corr =
      err.correlationId !== undefined && err.correlationId !== '' ?
        ` — corr ${err.correlationId.slice(0, 8)}`
      : '';
    return `${verb} failed (${code})${corr}`;
  }
  return `${verb} failed.`;
}

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

/**
 * After a proposal confirm succeeds, ask the host (rail container) to refresh OpenEMR's open
 * encounter view so the new/edited/deleted note appears in the Clinical Notes Form panel without
 * a manual click. Best-effort — same-origin postMessage with origin guard. The host listener
 * handles the bridge into OpenEMR's `refreshVisitDisplay()`.
 */
function notifyParentOfWriteConfirmed(writeTarget: string, expectedPatientUuid: string): void {
  if (typeof window.parent === 'undefined' || window.parent === null) {
    return;
  }

  window.parent.postMessage(
    {
      type: 'WRITE_CONFIRMED',
      write_target: writeTarget,
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
  /**
   * `openemr_denied` is reserved for real OpenEMR business rejections
   * (HTTP 200 from the module + `accepted: false` with a `reason`).
   * Transport/auth/server failures use `delivery_failed` so the rail
   * surfaces a typed code + correlation id instead of a misleading
   * "Rejected by OpenEMR" prefix.
   */
  phase: 'idle' | 'submitting' | 'accepted' | 'declined' | 'openemr_denied' | 'delivery_failed';
  openemrReason?: string | undefined;
  deliveryMessage?: string | undefined;
}>;

/**
 * Hydrate the local `ProposalPhase` from the persisted
 * `ProposalResolution` shape on `ChatBlock`. The persisted shape is a
 * narrower subset (only terminal phases) — `idle` and `submitting` are
 * never persisted. A reload mid-submit drops the user back to `idle`,
 * which is safe because the server's `not_pending` check makes a
 * duplicate confirm click a no-op.
 */
function phaseFromResolution(resolved: ProposalResolution | undefined): ProposalPhase {
  if (resolved === undefined) {
    return { phase: 'idle' };
  }
  switch (resolved.phase) {
    case 'accepted':
      return { phase: 'accepted' };
    case 'declined':
      return { phase: 'declined' };
    case 'openemr_denied':
      return { phase: 'openemr_denied', openemrReason: resolved.openemrReason };
    case 'delivery_failed':
      return { phase: 'delivery_failed', deliveryMessage: resolved.deliveryMessage };
  }
}

/**
 * Inverse of `phaseFromResolution` — narrow a transient
 * `ProposalPhase` to the persisted `ProposalResolution` shape, or
 * `null` if the phase is not terminal (idle/submitting). Callers pass
 * the result to the `onResolve` callback so the parent can write the
 * resolution back into the cached `ChatBlock`.
 */
function resolutionFromPhase(ui: ProposalPhase): ProposalResolution | null {
  switch (ui.phase) {
    case 'accepted':
      return { phase: 'accepted' };
    case 'declined':
      return { phase: 'declined' };
    case 'openemr_denied':
      return ui.openemrReason !== undefined
        ? { phase: 'openemr_denied', openemrReason: ui.openemrReason }
        : { phase: 'openemr_denied' };
    case 'delivery_failed':
      return ui.deliveryMessage !== undefined
        ? { phase: 'delivery_failed', deliveryMessage: ui.deliveryMessage }
        : { phase: 'delivery_failed' };
    case 'idle':
    case 'submitting':
      return null;
  }
}

/**
 * Notified when a proposal card transitions to a terminal phase
 * (accepted / declined / openemr_denied / delivery_failed). The parent
 * (`App.tsx`) walks `messages`, finds the matching proposal block by
 * `proposal_id`, and stamps the `resolved` field — which the
 * conversation cache then persists on its next write effect.
 */
export type OnProposalResolved = (
  proposalId: string,
  resolution: ProposalResolution,
) => void;

/**
 * Visual state for the proposal card surface, derived from `ProposalPhase`
 * + the voice-confirm shortcut. The CSS keys off `data-state` to swap the
 * card wash (idle = amber needs-decision, accepted/voice = success green,
 * declined/denied/failed = danger red) without a className modifier per
 * variant. Keeping it as a pure derivation means the component never has
 * to thread a className string through the JSX.
 */
type ProposalSurfaceState = 'idle' | 'submitting' | 'accepted' | 'voice' | 'declined' | 'denied' | 'failed';

function surfaceStateFor(ui: ProposalPhase, voiceDone: boolean): ProposalSurfaceState {
  if (voiceDone) return 'voice';
  switch (ui.phase) {
    case 'submitting':
      return 'submitting';
    case 'accepted':
      return 'accepted';
    case 'declined':
      return 'declined';
    case 'openemr_denied':
      return 'denied';
    case 'delivery_failed':
      return 'failed';
    case 'idle':
      return 'idle';
  }
}

/* ── Inline SVGs ──────────────────────────────────────────────────────
 * Inlined (not from an icon font) because the panel iframe is sandboxed
 * and can't pull external assets. Stroked, not filled, so they inherit
 * the parent text color via `currentColor` and shrink/grow with type
 * size without rasterizing. `aria-hidden` because the surrounding text
 * carries the accessible name in every case.
 */
function IconClipboardCheck(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="m9 14 2 2 4-4" />
    </svg>
  );
}

function IconCheck(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function IconX(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

function IconAlert(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2 1 21h22L12 2Z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

function IconMicCheck(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function IconTrash(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6 17.6 19.1A2 2 0 0 1 15.6 21H8.4a2 2 0 0 1-2-1.9L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function IconBan(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </svg>
  );
}

function IconInfo(): ReactElement {
  return (
    <svg
      className="agentforge-msg__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.6" fill="currentColor" />
    </svg>
  );
}

// IconArrowOut (a "↗" marker after navigable citations) was removed in PR-N: the marker
// implied "external link" to clinicians, and the dotted underline + link color already
// signal "click to navigate" sufficiently for inline chart citations.

/*
 * The "CP" rounded-square avatar that briefly lived here in PR3 was
 * removed in PR5. Rationale: the product target is the Cursor / Claude /
 * ChatGPT chat convention where the assistant's prose flows on the
 * canvas with no chrome around it (no avatar, no author label, no
 * card border). Users have internalised that pattern so deeply that
 * the *absence* of a container is itself the authorship signal —
 * adding an avatar back fights the convention rather than honouring
 * it. The user bubble (right-aligned, light-blue) carries the user
 * authorship signal symmetrically. Bounded sub-blocks (proposals,
 * alerts, tool calls) stay as cards because they're affordances, not
 * prose.
 */

/**
 * Friendlier write-target chip label. Backend ships snake_case enum-ish
 * strings (`vitals`, `medication`, `chief_complaint`, `clinical_note`);
 * the chip in the card header should read like clinician prose. Pure
 * presentation — the underlying `write_target` value is unchanged on the wire.
 *
 * `chief_complaint` is relabeled "Reason for visit" because the underlying
 * write target is `form_encounter.reason` (the front-desk-entered field), not
 * a free-form chief complaint narrative. Calling it "Chief complaint" in the
 * UI confuses physicians into accepting writes that overwrite intake data.
 */
function formatWriteTarget(target: string): string {
  if (target === 'chief_complaint') return 'Reason for visit';
  if (target === 'clinical_note') return 'Clinical note';
  if (target === 'clinical_note_update') return 'Update note';
  if (target === 'clinical_note_delete') return 'Delete note';
  return target
    .split('_')
    .map((p) => (p.length > 0 ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join(' ');
}

function ProposalBlock(
  props: Readonly<{
    block: ProposalBlockInner;
    proposalEnv?: ProposalApiEnv;
    voiceCompletedProposalIds?: ReadonlySet<string>;
    onResolve?: OnProposalResolved;
  }>,
): ReactElement {
  const { proposalEnv, onResolve } = props;
  const voiceDone = props.voiceCompletedProposalIds?.has(props.block.proposal_id) === true;

  // Lazy-init from the persisted resolution. After remount (Refresh
  // chart, panel reload), the conversation cache replays this block
  // with its `resolved` field populated, so the card opens already
  // showing "Accepted." / "Declined." instead of an active Confirm /
  // Reject pair the user could double-fire.
  const [ui, setUi] = useState<ProposalPhase>(() => phaseFromResolution(props.block.resolved));

  /**
   * Setter wrapper that bubbles terminal transitions up to the parent
   * via `onResolve`. Called everywhere we previously did `setUi(next)`
   * for a non-transient phase. Idle/submitting transitions are local
   * only — they never make it to the conversation cache.
   */
  function setUiAndPersist(next: ProposalPhase): void {
    setUi(next);
    const resolution = resolutionFromPhase(next);
    if (resolution !== null) {
      onResolve?.(props.block.proposal_id, resolution);
    }
  }

  const canInteract = proposalEnv !== undefined && ui.phase === 'idle' && !voiceDone;
  const showDecisionButtons =
    !voiceDone && (ui.phase === 'idle' || ui.phase === 'submitting');
  const surfaceState = surfaceStateFor(ui, voiceDone);
  // Delete-type proposals get a destructive button pair (Delete/Cancel, red primary, trash
  // icon) instead of the default Confirm/Reject. Detected by `_delete` suffix so future
  // delete targets (e.g. medication_delete) pick this up automatically.
  const isDelete = props.block.write_target.endsWith('_delete');

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
    if (ui.phase === 'delivery_failed') {
      return ui.deliveryMessage !== undefined && ui.deliveryMessage.trim() !== '' ?
          ui.deliveryMessage
        : 'Request failed.';
    }
    return '';
  }

  /**
   * Pick the icon paired with the status pill. The icon is decorative —
   * the pill text already carries the accessible meaning — but the visual
   * cue is what makes the resolved state read at a glance instead of
   * forcing the clinician to parse a sentence.
   */
  function statusIcon(): ReactElement | null {
    switch (surfaceState) {
      case 'accepted':
      case 'voice':
        return surfaceState === 'voice' ? <IconMicCheck /> : <IconCheck />;
      case 'declined':
        return <IconX />;
      case 'denied':
      case 'failed':
        return <IconAlert />;
      case 'submitting':
      case 'idle':
        return null;
    }
  }

  async function onConfirm(): Promise<void> {
    if (proposalEnv === undefined || ui.phase !== 'idle') return;
    const env = proposalEnv;
    const proposalId = props.block.proposal_id;

    setUi({ phase: 'submitting' });
    try {
      const outcome = await postProposalConfirm(env.apiBase, env.sessionToken, env.patientUuid, env.conversationId, proposalId);
      if (outcome.accepted) {
        setUiAndPersist({ phase: 'accepted' });
        notifyParentOfWriteConfirmed(props.block.write_target, env.patientUuid);
      } else {
        setUiAndPersist({ phase: 'openemr_denied', openemrReason: outcome.reason });
      }
    } catch (e) {
      setUiAndPersist({ phase: 'delivery_failed', deliveryMessage: formatDeliveryFailure(isDelete ? 'Delete' : 'Confirm', e) });
    }
  }

  async function onReject(): Promise<void> {
    if (proposalEnv === undefined || ui.phase !== 'idle') return;
    const env = proposalEnv;
    const proposalId = props.block.proposal_id;

    setUi({ phase: 'submitting' });
    try {
      await postProposalReject(env.apiBase, env.sessionToken, env.patientUuid, env.conversationId, proposalId);
      setUiAndPersist({ phase: 'declined' });
    } catch (e) {
      setUiAndPersist({ phase: 'delivery_failed', deliveryMessage: formatDeliveryFailure(isDelete ? 'Cancel' : 'Decline', e) });
    }
  }

  const status = statusText();
  const icon = statusIcon();

  return (
    <div
      className="agentforge-msg__proposal-card"
      data-state={surfaceState}
      aria-label={`Proposed ${props.block.write_target}`}
    >
      <header className="agentforge-msg__proposal-header">
        <span className="agentforge-msg__proposal-label">
          <IconClipboardCheck />
          <span>Proposed change</span>
        </span>
        <span className="agentforge-msg__proposal-target">{formatWriteTarget(props.block.write_target)}</span>
      </header>

      <p className="agentforge-msg__proposal-preview">{props.block.preview}</p>

      {status !== '' ?
        <p className="agentforge-msg__proposal-status" role="status">
          {icon}
          <span>{status}</span>
        </p>
      : null}

      {showDecisionButtons ?
        <div className="agentforge-msg__proposal-actions">
          <button
            type="button"
            className={
              isDelete ?
                'agentforge-msg__proposal-btn agentforge-msg__proposal-btn--danger'
              : 'agentforge-msg__proposal-btn agentforge-msg__proposal-btn--primary'
            }
            onClick={() => void onConfirm()}
            disabled={!canInteract}
          >
            {isDelete ? <IconTrash /> : <IconCheck />}
            <span>{isDelete ? 'Delete' : 'Confirm'}</span>
          </button>
          <button
            type="button"
            className="agentforge-msg__proposal-btn agentforge-msg__proposal-btn--secondary"
            onClick={() => void onReject()}
            disabled={!canInteract}
          >
            <IconX />
            <span>{isDelete ? 'Cancel' : 'Reject'}</span>
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
    readonly onProposalResolved?: OnProposalResolved;
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
          {...(opts.onProposalResolved !== undefined ?
            { onResolve: opts.onProposalResolved }
          : {})}
        />
      : (
          <ProposalBlock
            key={key}
            block={block}
            {...(opts.voiceCompletedProposalIds !== undefined ?
              { voiceCompletedProposalIds: opts.voiceCompletedProposalIds }
            : {})}
            {...(opts.onProposalResolved !== undefined ?
              { onResolve: opts.onProposalResolved }
            : {})}
          />
        );
    case 'text':
      if (opts.assistantMessage === true) {
        // Assistant prose runs through Markdown so `**bold**`, `### headings`,
        // and `- bullets` render as structure (not literal punctuation). The
        // div wrapper from AssistantMarkdown replaces the raw <p> here so
        // block-level Markdown (h3/h4, ul/ol, pre) can nest legally.
        return (
          <div key={key} className="agentforge-msg__text">
            <AssistantMarkdown text={displayAssistantText(block.text)} />
          </div>
        );
      }
      return (
        <p key={key} className="agentforge-msg__text">
          {block.text}
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
                if (opts.assistantMessage === true) {
                  // Inline Markdown: bold/italic/code render, but block-level
                  // constructs are unwrapped so they can't break out of the
                  // surrounding <p> (claim sentences sit between cite buttons).
                  return <AssistantMarkdown key={i} text={t} inline />;
                }
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
      // Inline mode keeps Markdown formatting (bold drug names, etc.) but
      // unwraps anything block-level so the result nests safely inside a
      // <button> or <p>.
      const renderedText =
        opts.assistantMessage === true ? <AssistantMarkdown text={text} inline /> : text;

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
                {renderedText}
              </button>
            ) : (
              renderedText
            )}
          </p>
        );
      }

      return (
        <p key={key} className="agentforge-msg__claim">
          {renderedText}
        </p>
      );
    }
    case 'warning':
      return (
        <p key={key} className="agentforge-msg__warning" role="status">
          <IconAlert />
          <span>
            <strong>Warning:</strong>{' '}
            {opts.assistantMessage === true ?
              <AssistantMarkdown text={block.text} inline />
            : block.text}
          </span>
        </p>
      );
    case 'refusal':
      return (
        <p key={key} className="agentforge-msg__refusal" role="alert">
          <IconBan />
          <span><strong>Refusal:</strong> {block.reason}</span>
        </p>
      );
    case 'tool_call':
      return (
        <details key={key} className="agentforge-msg__tool agentforge-msg__tool--call">
          <summary>
            <span className="agentforge-msg__tool-label">Tool:</span>{' '}
            <code className="agentforge-msg__tool-name">{block.name}</code>
          </summary>
          {block.detail !== undefined && block.detail !== '' ? <pre>{block.detail}</pre> : null}
        </details>
      );
    case 'tool_result':
      return (
        <details key={key} className="agentforge-msg__tool agentforge-msg__tool--result">
          <summary>
            <span className="agentforge-msg__tool-label">Result:</span>{' '}
            <code className="agentforge-msg__tool-name">{block.tool}</code>
          </summary>
          {block.detail !== undefined && block.detail !== '' ? <pre>{block.detail}</pre> : null}
        </details>
      );
    default:
      return (
        <p key={key} className="agentforge-msg__unknown">
          (Unsupported block)
        </p>
      );
  }
}

/**
 * Whenever an assistant message contains a proposal block, the proposal card itself is the
 * complete affordance — preview text + Confirm/Reject buttons. Any prose the model emits
 * alongside it (narration like "I'll add this to the note", restatements of the preview,
 * Y/N confirmations) is noise that undermines trust ("the assistant is talking past the
 * card I'm about to click"). Suppress all text and claim blocks in any message that has a
 * proposal — deterministic, no model-side prompt rules to drift away.
 *
 * Warnings, refusals, tool_call, and tool_result blocks are preserved because they carry
 * safety/audit signal that doesn't restate the proposal. Proposal blocks themselves are
 * always preserved (suppressing them would hide the actionable card).
 *
 * No-op when there are no proposal blocks in the message.
 */
function suppressDuplicateProposalNarration(blocks: readonly ChatBlock[]): ChatBlock[] {
  const hasProposal = blocks.some((b) => b.type === 'proposal');
  if (!hasProposal) {
    return [...blocks];
  }

  return blocks.filter((b) => b.type !== 'text' && b.type !== 'claim');
}

export type { ChatMessage } from '../types/chat.js';

export function MessageList(props: {
  readonly messages: readonly ChatMessage[];
  readonly boundPatientUuid: string | null;
  readonly proposalEnv?: ProposalApiEnv;
  readonly voiceCompletedProposalIds?: ReadonlySet<string>;
  /**
   * Bubbled up to App so it can stamp the matching proposal block's
   * `resolved` field, which the conversation cache then persists. See
   * `OnProposalResolved` for shape.
   */
  readonly onProposalResolved?: OnProposalResolved;
}): ReactElement {
  const [notice, setNotice] = useState<string | null>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = messagesScrollRef.current;
    if (el === null) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [props.messages, notice]);

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
    <div ref={messagesScrollRef} className="agentforge-messages" aria-live="polite">
      {notice !== null ? (
        <p className="agentforge-msg__nav-notice" role="status">
          <IconInfo />
          <span>{notice}</span>
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
            {/* Dictation badge sits at the top of the user bubble. The
                user-side authorship signal is the bubble itself (right-
                aligned, light-blue); the badge layers on origin
                ("transcribed from voice, treat odd phrasing as ASR error
                rather than a typo"). Assistant messages render no header
                at all — no avatar, no label — so the prose flows on the
                canvas the way Cursor / Claude / ChatGPT have trained
                users to expect.

                The article's `aria-label` ("You" / "Assistant" /
                "You (dictation)") still carries the accessible name for
                screen readers, so removing the visible label is purely a
                visual change. */}
            {isDictation ? (
              <span className="agentforge-msg__dictation-badge" aria-label="Dictated">
                Dictation
              </span>
            ) : null}
            {(m.role === 'assistant' ? suppressDuplicateProposalNarration(m.blocks) : m.blocks).map((b, j) =>
              renderBlock(b, `${i}-${j}`, {
                assistantMessage: m.role === 'assistant',
                boundPatientUuid: props.boundPatientUuid,
                ...(props.proposalEnv !== undefined && m.role === 'assistant' ? { proposalEnv: props.proposalEnv } : {}),
                ...(props.voiceCompletedProposalIds !== undefined ?
                  { voiceCompletedProposalIds: props.voiceCompletedProposalIds }
                : {}),
                ...(props.onProposalResolved !== undefined && m.role === 'assistant' ?
                  { onProposalResolved: props.onProposalResolved }
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
