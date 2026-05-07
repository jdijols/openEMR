import type { ReactElement } from 'react';
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { AgentForgeDeliveryError, postProposalConfirm, postProposalReject } from '../api/client.js';
import type {
  ChatBlock,
  ChatMessage,
  CitationNavigationHint,
  ProposalResolution,
} from '../types/chat.js';
import AssistantMarkdown from './AssistantMarkdown.js';
import { AgentStepStrip } from './AgentStepStrip.js';
import { AttachmentPreview } from './AttachmentPreview.js';
import { ExtractionAcknowledgment } from './ExtractionAcknowledgment.js';
import { IntakeProposalCard } from './IntakeProposalCard.js';
import type { IntakeDispatchEnv } from './intake_dispatch.js';
import { ProposalCardShell, type ProposalCardActionsConfig, type ProposalCardState } from './ProposalCardShell.js';
import { TypingIndicator } from './TypingIndicator.js';

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
  // G2-MVP-99 — guideline-chunk citations open their primary source URL
  // directly in a new tab. The parent OpenEMR shell only handles
  // intra-chart NAV_REQUEST kinds (chart_section / patient_dashboard /
  // encounter / visit_history); posting a `guideline_chunk` kind falls
  // through to the chart-refresh path on the host side, which is the
  // wrong outcome for an external citation. Mirrors the standalone
  // CitationLink component's behavior.
  if (hint.kind === 'guideline_chunk') {
    const sourceUrl = (hint.params as { source_url?: unknown }).source_url;
    if (typeof sourceUrl === 'string' && sourceUrl !== '') {
      window.open(sourceUrl, '_blank', 'noopener');
    }
    return;
  }

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

function IconExternalLink(): ReactElement {
  return (
    <svg
      className="agentforge-msg__cite-marker"
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

// IconExternalLink — the "↗" marker is appended only to citations that open in a new
// tab (guideline_chunk → external RAG source). In-app citations (lab_pdf, intake_form,
// openemr_record, encounter) keep the bare dotted underline because their click navigates
// inside the chart, not out of it. An earlier revision attached this marker to all
// navigable citations and was reverted because the "external link" read was misleading
// for chart-internal navigation.

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
    if (ui.phase === 'declined') return 'Rejected.';
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
      setUiAndPersist({ phase: 'delivery_failed', deliveryMessage: formatDeliveryFailure(isDelete ? 'Cancel' : 'Reject', e) });
    }
  }

  const status = statusText();
  const icon = statusIcon();

  // Map ProposalBlock's surfaceState (which already mirrors the
  // ProposalCardShell vocabulary 1:1) onto the shell's state prop.
  const shellState: ProposalCardState = surfaceState;

  const actions: ProposalCardActionsConfig | undefined = showDecisionButtons ?
    {
      onConfirm: () => void onConfirm(),
      onReject: () => void onReject(),
      confirmLabel: isDelete ? 'Delete' : 'Confirm',
      rejectLabel: isDelete ? 'Cancel' : 'Reject',
      confirmIcon: isDelete ? <IconTrash /> : <IconCheck />,
      rejectIcon: <IconX />,
      confirmVariant: isDelete ? 'danger' : 'primary',
      disabled: !canInteract,
    }
  : undefined;

  return (
    <ProposalCardShell
      state={shellState}
      headerIcon={<IconClipboardCheck />}
      title="Proposed change"
      targetLabel={formatWriteTarget(props.block.write_target)}
      ariaLabel={`Proposed ${props.block.write_target}`}
      {...(status !== '' ? { statusMessage: status } : {})}
      {...(icon !== null ? { statusIcon: icon } : {})}
      {...(actions !== undefined ? { actions } : {})}
      {...(proposalEnv === undefined ?
        { hint: 'Thread not ready — send a chart message after opening the Assistant.' }
      : {})}
    >
      <p className="agentforge-msg__proposal-preview">{props.block.preview}</p>
    </ProposalCardShell>
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
    /** G2-Early-26 — IntakeProposalCard Confirm dispatch context (module endpoint base + auth). */
    readonly intakeDispatchEnv?: IntakeDispatchEnv;
    readonly voiceCompletedProposalIds?: ReadonlySet<string>;
    readonly onProposalResolved?: OnProposalResolved;
    readonly onOpenDocument?: (docrefUuid: string, page?: number) => void;
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

              // G2-MVP-99 — guideline_chunk citations open the source URL
              // in a new tab. Render as a native `<a target="_blank">` so
              // the browser handles the navigation regardless of iframe
              // context (window.open from inside an iframe was being
              // silently swallowed in some Chromium configurations).
              if (canNav && hint.kind === 'guideline_chunk') {
                const sourceUrl = (hint.params as { source_url?: unknown }).source_url;
                if (typeof sourceUrl === 'string' && sourceUrl !== '') {
                  return (
                    <a
                      key={i}
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="agentforge-msg__cite-link"
                    >
                      {seg.text}
                      <IconExternalLink />
                    </a>
                  );
                }
              }

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

        // G2-MVP-99 — same iframe-safe anchor pattern as the segment
        // branch above: external guideline URLs render as `<a target="_blank">`
        // so the browser opens them in a new top-level tab regardless of
        // iframe context.
        if (canNav && hint.kind === 'guideline_chunk') {
          const sourceUrl = (hint.params as { source_url?: unknown }).source_url;
          if (typeof sourceUrl === 'string' && sourceUrl !== '') {
            return (
              <p key={key} className="agentforge-msg__claim">
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="agentforge-msg__cite-link"
                >
                  {renderedText}
                  <IconExternalLink />
                </a>
              </p>
            );
          }
        }

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
    case 'extraction': {
      const fileName = block.doc_type === 'lab_pdf' ? 'lab PDF' : 'intake form';
      const ackStatus =
        block.doc_type === 'lab_pdf' ?
          ({
            status: 'resolved' as const,
            docType: 'lab_pdf' as const,
            fileName,
            nFacts: block.n_facts,
            ...(block.n_abnormal !== undefined ? { nAbnormal: block.n_abnormal } : {}),
          })
        : ({
            status: 'resolved' as const,
            docType: 'intake_form' as const,
            fileName,
            nFacts: block.n_facts,
          });
      return (
        <div key={key} className="agentforge-msg__extraction">
          <ExtractionAcknowledgment status={ackStatus} />
          {opts.onOpenDocument !== undefined ? (
            <p style={{ margin: '0.25rem 0 0 0' }}>
              <button
                type="button"
                className="agentforge-msg__cite-link"
                onClick={() => opts.onOpenDocument?.(block.docref_uuid, 1)}
              >
                View source PDF
              </button>
            </p>
          ) : null}
          {block.doc_type === 'intake_form' && block.intake_data !== undefined ? (
            <IntakeProposalCard
              data={block.intake_data}
              onConfirm={() => {
                if (opts.intakeDispatchEnv !== undefined) {
                  notifyParentOfWriteConfirmed('intake_proposal', opts.intakeDispatchEnv.patientUuid);
                }
              }}
              onReject={() => {
                /* no-op — UI state lives inside the card. */
              }}
              {...(opts.intakeDispatchEnv !== undefined ? { dispatchEnv: opts.intakeDispatchEnv } : {})}
            />
          ) : null}
          {/* G2-Early-27 — Lab summary card-dedup: the actionable proposal card emitted by
              the orchestrator (via maybeBuildLabSummaryProposal) is the SOLE render of the
              lab summary bullet list. The previous informational ProposalCardShell preview
              was visually identical and confused users into thinking there were two
              actions to take. Killed in favor of the single Confirm/Reject card. The
              ExtractionAcknowledgment above ("Read the lab — N results, N abnormal") is
              the only thing rendered alongside the proposal. */}
        </div>
      );
    }
    case 'agent_step':
      return (
        <AgentStepStrip
          key={key}
          block={{
            worker: block.worker,
            reason: block.reason,
            input_summary: block.input_summary,
            duration_ms: block.duration_ms,
            outcome: block.outcome,
            ...(block.stats !== undefined ? { stats: block.stats } : {}),
          }}
        />
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
  // G2-MVP-99 — extraction blocks behave the same way as proposal blocks
  // for this purpose: ExtractionAcknowledgment + IntakeProposalCard already
  // present the headline/invitation/structured fields; any LLM commentary
  // alongside (e.g. "Intake Form Extracted / Chief Concern / …" headings)
  // restates the same content and undermines trust.
  const hasProposalLike = blocks.some((b) => b.type === 'proposal' || b.type === 'extraction');
  if (!hasProposalLike) {
    return [...blocks];
  }

  return blocks.filter((b) => b.type !== 'text' && b.type !== 'claim');
}

export type { ChatMessage } from '../types/chat.js';

export function MessageList(props: {
  readonly messages: readonly ChatMessage[];
  readonly boundPatientUuid: string | null;
  readonly proposalEnv?: ProposalApiEnv;
  /** G2-Early-26 — IntakeProposalCard fans out per-section writes through this env. */
  readonly intakeDispatchEnv?: IntakeDispatchEnv;
  readonly voiceCompletedProposalIds?: ReadonlySet<string>;
  /**
   * Bubbled up to App so it can stamp the matching proposal block's
   * `resolved` field, which the conversation cache then persists. See
   * `OnProposalResolved` for shape.
   */
  readonly onProposalResolved?: OnProposalResolved;
  /**
   * G2-MVP-99 — open the source PDF/image modal at a given page. Plumbed
   * through to extraction-block "View source PDF" buttons. App owns the
   * modal state.
   */
  readonly onOpenDocument?: (docrefUuid: string, page?: number) => void;
  /**
   * G2-MVP-99 — when true, render the assistant typing indicator at the
   * bottom of the scroll container as if it were the next incoming
   * message. App.tsx flips this on while a /chat request is in flight.
   */
  readonly typing?: boolean;
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
        const visibleBlocks = m.role === 'assistant'
          ? suppressDuplicateProposalNarration(m.blocks)
          : m.blocks;
        // For user turns, the text bubble only renders when there's
        // something to show. A file-only send (no caption) skips the
        // bubble entirely so the standalone chip stands by itself,
        // iMessage-style.
        const hasBubbleContent = m.role !== 'user' || visibleBlocks.length > 0;
        return (
          <Fragment key={i}>
            {/* G2-MVP-99 — standalone attachment row for user sends.
                Rendered as its own article (no blue bubble, no border),
                right-aligned to match the user side, so the file reads
                as its own object in the thread (iMessage / WhatsApp
                pattern). Click opens DocumentModal once the upload
                has resolved a docref. */}
            {m.role === 'user' && m.attachment !== undefined ? (
              <article
                className="agentforge-msg agentforge-msg--attachment-row"
                aria-label="Attached file"
              >
                <AttachmentPreview
                  file={m.attachment.file}
                  {...(m.attachment.docrefUuid !== undefined && props.onOpenDocument !== undefined
                    ? { onClick: () => props.onOpenDocument!(m.attachment!.docrefUuid!, 1) }
                    : {})}
                />
              </article>
            ) : null}
            {hasBubbleContent ? (
              <article
                className={`agentforge-msg agentforge-msg--${m.role}${isDictation ? ' agentforge-msg--dictation' : ''}`}
                aria-label={m.role === 'user' ? (isDictation ? 'You (dictation)' : 'You') : 'Assistant'}
              >
                {/* Dictation badge sits at the top of the user bubble. */}
                {isDictation ? (
                  <span className="agentforge-msg__dictation-badge" aria-label="Dictated">
                    Dictation
                  </span>
                ) : null}
                {visibleBlocks.map((b, j) =>
                  renderBlock(b, `${i}-${j}`, {
                    assistantMessage: m.role === 'assistant',
                    boundPatientUuid: props.boundPatientUuid,
                    ...(props.proposalEnv !== undefined && m.role === 'assistant' ? { proposalEnv: props.proposalEnv } : {}),
                    ...(props.intakeDispatchEnv !== undefined && m.role === 'assistant' ?
                      { intakeDispatchEnv: props.intakeDispatchEnv }
                    : {}),
                    ...(props.voiceCompletedProposalIds !== undefined ?
                      { voiceCompletedProposalIds: props.voiceCompletedProposalIds }
                    : {}),
                    ...(props.onProposalResolved !== undefined && m.role === 'assistant' ?
                      { onProposalResolved: props.onProposalResolved }
                    : {}),
                    ...(m.role === 'assistant' && m.citation_navigation !== undefined ?
                      { citationNav: m.citation_navigation }
                    : {}),
                    ...(props.onOpenDocument !== undefined ? { onOpenDocument: props.onOpenDocument } : {}),
                  }),
                )}
              </article>
            ) : null}
          </Fragment>
        );
      })}
      {/* G2-MVP-99 — typing indicator lives inside the scroll container
          so it appears as the next-message-coming-in (left-aligned,
          beneath the most recent assistant/user turn) instead of
          floating above the compose form. */}
      <TypingIndicator visible={props.typing === true} />
    </div>
  );
}
