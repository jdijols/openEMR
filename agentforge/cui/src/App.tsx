import type { ChangeEvent, DragEvent, FormEvent, ReactElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AgentForgeDeliveryError, postChat, postPresentPatient, postProposalConfirm, postProposalReject, postUploadDocument } from './api/client.js';
import { AboveComposerAffordance, type AboveComposerState } from './proposals/AboveComposerAffordance.js';
import { broadcast as broadcastProposalEvent, subscribe as subscribeProposalEvents } from './proposals/proposalBus.js';
import { readCachedBrief, writeCachedBrief } from './chat/brief_cache.js';
import { readCachedConversation, writeCachedConversation } from './chat/conversation_cache.js';
import { MessageList, type ChatMessage, type ProposalApiEnv } from './chat/MessageList.js';
import { StatusLabel } from './chat/StatusLabel.js';
import { AttachmentPreview } from './chat/AttachmentPreview.js';
import { validateFileBasic } from './chat/useFileValidation.js';
import { findProposalQueue } from './chat/proposal_lookup.js';
import { tryConfirmProposalFromDictation } from './chat/voice_confirm_proposal.js';
import { useHandshake } from './chat/useHandshake.js';
import MicControl from './recording/MicControl.js';
import { readApiBase, readModuleBase } from './config.js';
import { EvalGateBadge } from './footer/EvalGateBadge.js';
import { PhiRedactionBadge } from './footer/PhiRedactionBadge.js';
import type { ProposalResolution } from './types/chat.js';

function readDocumentHints(): {
  launchCode: string | null;
  patientUuid: string | null;
  copilotTitle: string | null;
  boundEncounterId: number | null;
} {
  const root = document.documentElement;
  const launch = root.getAttribute('data-launch-code');
  const patient = root.getAttribute('data-patient-uuid');
  const title = root.getAttribute('data-patient-copilot-title');
  const encRaw = root.getAttribute('data-bound-encounter-id');
  const encParsed = encRaw !== null && encRaw !== '' ? Number.parseInt(encRaw, 10) : NaN;
  return {
    launchCode: launch !== null && launch !== '' ? launch : null,
    patientUuid: patient !== null && patient !== '' ? patient : null,
    copilotTitle: title !== null && title !== '' ? title : null,
    boundEncounterId: Number.isFinite(encParsed) && encParsed > 0 ? encParsed : null,
  };
}

function newConversationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cui-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Ask the host shell to navigate the OpenEMR Dashboard tab to this patient
 * (open if closed, refresh if already open). Same NAV_REQUEST envelope used
 * by chart citations; the parent listener routes `kind: 'patient_dashboard'`
 * into `loadCurrentPatient()` — the same global the top-bar patient-name
 * link is bound to, so the UX is identical to that pattern.
 */
function requestPatientDashboardNavigation(expectedPatientUuid: string): void {
  if (typeof window.parent === 'undefined' || window.parent === null) {
    return;
  }
  window.parent.postMessage(
    {
      type: 'NAV_REQUEST',
      hint: { kind: 'patient_dashboard', params: {} },
      expected_patient_uuid: expectedPatientUuid,
    },
    window.location.origin,
  );
}

/**
 * Ask the host shell to open a specific encounter in the OpenEMR "enc" tab.
 * Used by the header "Today" link, which targets the encounter the
 * AppointmentEncounterBinder picked at panel render time (i.e. today's
 * appointment-driven encounter).
 */
function requestEncounterNavigation(encounterId: number, expectedPatientUuid: string): void {
  if (typeof window.parent === 'undefined' || window.parent === null) {
    return;
  }
  window.parent.postMessage(
    {
      type: 'NAV_REQUEST',
      hint: { kind: 'encounter', params: { encounter_id: encounterId } },
      expected_patient_uuid: expectedPatientUuid,
    },
    window.location.origin,
  );
}

/**
 * Ask the host shell to open the patient's Visit History (encounter list) in
 * the OpenEMR "enc" tab — mirrors the clock icon left of "Select Encounter"
 * in the OpenEMR top patient panel (`clickEncounterList` → `encounterList()`
 * → `/interface/patient_file/history/encounters.php`).
 */
function requestVisitHistoryNavigation(expectedPatientUuid: string): void {
  if (typeof window.parent === 'undefined' || window.parent === null) {
    return;
  }
  window.parent.postMessage(
    {
      type: 'NAV_REQUEST',
      hint: { kind: 'visit_history', params: {} },
      expected_patient_uuid: expectedPatientUuid,
    },
    window.location.origin,
  );
}

/**
 * Brief lifecycle state machine — replaces the prior pair of refs
 * (`briefAutoFiredRef` + `pendingPresentRef`) plus the `presenting` boolean
 * that together produced four post-deploy bugs:
 *
 *   1. The boolean marker in sessionStorage flipped to "fired" before the
 *      network call resolved, so a transient failure pinned the rail blank
 *      with no in-mount retry path.
 *   2. The `AGENTFORGE_PRESENT_PATIENT` postMessage handler raced the
 *      handshake (`pendingPresentRef` was a workaround that itself raced
 *      with the iframe re-mount).
 *   3. React StrictMode in dev double-fired the auto-trigger, briefly
 *      double-prepending the brief.
 *   4. The "Preparing case presentation…" hint flickered out of sync with
 *      the actual fetch lifecycle.
 *
 * The machine collapses these into a single discriminated-union state.
 * The `briefInFlightRef` is the synchronous companion that closes the
 * StrictMode race: setState writes are async, so two effect runs in the
 * same tick can both observe `idle` before either flips to `loading`.
 */
type BriefStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'cached' }
  | { kind: 'success' }
  | { kind: 'failed'; error: AgentForgeDeliveryError };

function toDeliveryFailure(err: unknown): AgentForgeDeliveryError {
  return err instanceof AgentForgeDeliveryError ? err : new AgentForgeDeliveryError('backend_error');
}

function describeSendFailure(err: AgentForgeDeliveryError): string {
  const ref =
    err.correlationId !== undefined && err.correlationId !== '' ? ` Reference ID: ${err.correlationId}.` : '';

  switch (err.kind) {
    case 'misconfigured_llm':
      return 'The assistant is not configured on the server (LLM provider).';
    case 'network_unreachable':
      return 'Cannot reach the assistant service. Check the network, HTTPS / mixed-content, or that the Agent API URL is correct.';
    case 'bad_request':
      return `The assistant rejected this message.${ref}`;
    case 'invalid_success_response':
      return `The assistant returned an unexpected response.${ref}`;
    case 'backend_error':
      return `Assistant backend error.${ref} If case presentation worked but chat does not, run Agent Postgres migrations (agentforge/api → npm run db:migrate — includes 002_gate4_conversations.sql) and restart the API container.`;
  }
}

/**
 * Circular arrows — visually aligned with OpenEMR tab chrome (`fa-sync` in
 * `tabs_template.html.twig`); inlined because `panel.php` does not ship
 * Font Awesome into the iframe.
 */
function IconPanelSync(): ReactElement {
  return (
    <svg
      className="agentforge-cui__refresh-icon"
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
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

/**
 * Outline clock — same stroke-only treatment as IconPanelSync so the two
 * header buttons read as a matching pair. Mirrors the `fa-history` glyph
 * OpenEMR uses for the same action in the top patient panel.
 */
function IconVisitHistory(): ReactElement {
  return (
    <svg
      className="agentforge-cui__refresh-icon"
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
      <polyline points="12 7 12 12 15 14" />
    </svg>
  );
}

/**
 * Plus glyph for the composer's inline attach affordance. Stroked so it
 * inherits color from `currentColor`, matching the other inline icons in
 * the panel header (`IconPanelSync`, `IconVisitHistory`).
 */
function IconPlus(): ReactElement {
  return (
    <svg
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
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

const DEFAULT_COPILOT_HEADER = 'Clinical Copilot';

export default function App(): ReactElement {
  const { launchCode, patientUuid, copilotTitle, boundEncounterId } = useMemo(() => readDocumentHints(), []);
  const handshake = useHandshake(launchCode, patientUuid);
  const headerTitle = copilotTitle ?? DEFAULT_COPILOT_HEADER;
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationExternalId, setConversationExternalId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Live routing affordance during a /chat turn. Set when the SSE stream
  // delivers a `routing` event (the supervisor's call to a worker tool just
  // began), cleared when the turn ends. The CUI shows this label above the
  // typing indicator's bare ellipsis so the physician sees what the agent
  // is mid-doing rather than waiting in silence for the response.
  const [routingLabel, setRoutingLabel] = useState<string | null>(null);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>({ kind: 'idle' });
  const [sendFailure, setSendFailure] = useState<AgentForgeDeliveryError | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [voiceCompletedProposalIds, setVoiceCompletedProposalIds] = useState(() => new Set<string>());
  // G2-MVP-99 — file attachment state for the composer.
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // G2-Final — above-composer affordance state for the hybrid agent/manual proposal flow.
  const [affordanceState, setAffordanceState] = useState<AboveComposerState>('idle');
  const [affordanceError, setAffordanceError] = useState<string | null>(null);
  // Phase 1 — head-only broadcast tracking. `lastBroadcastedHeadIdRef` holds
  // the head id we most recently registered (broadcast or initial-mount
  // suppress). `initialHeadCheckedRef` flips to true on first observation so
  // a chart that mounts with a cached unresolved proposal does NOT auto-pop
  // its modal — the user sees the affordance and clicks into it. New head
  // transitions after that DO broadcast.
  const lastBroadcastedHeadIdRef = useRef<string | null>(null);
  const initialHeadCheckedRef = useRef<boolean>(false);

  // Loading hint is a derivation of the state machine, not an independent
  // boolean — the two used to drift apart on transient failures.
  const presenting = briefStatus.kind === 'loading';

  const apiBase = useMemo(() => readApiBase(), []);
  const moduleBase = useMemo(() => readModuleBase(), []);
  const messagesRef = useRef<ChatMessage[]>([]);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useLayoutEffect(() => {
    if (handshake.status !== 'ready') {
      return;
    }
    const el = composeInputRef.current;
    if (el === null) return;
    el.style.height = 'auto';
    const maxRaw = typeof getComputedStyle !== 'undefined' ? getComputedStyle(el).maxHeight : '';
    const maxPx = Number.parseFloat(maxRaw);
    const natural = el.scrollHeight;
    const next =
      Number.isFinite(maxPx) && maxPx > 0 ?
        Math.min(natural, maxPx)
      : natural;
    el.style.height = `${next}px`;
  }, [handshake.status, input]);

  // Mint a conversation id as soon as the handshake is ready and a patient is bound.
  // The server upserts the row on first use (chat or WS auth), so the mic enables
  // immediately on chart load — no chat-first requirement (PRD §6.4).
  // Patient changes re-handshake via panel.php, which re-mounts App and mints a new id.
  useEffect(() => {
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      return;
    }
    setConversationExternalId((prev) => (prev !== null && prev !== '' ? prev : newConversationId()));
  }, [handshake.status, patientUuid]);

  const proposalEnv: ProposalApiEnv | undefined = useMemo(() => {
    if (
      handshake.status !== 'ready' ||
      conversationExternalId === null ||
      conversationExternalId.trim() === '' ||
      patientUuid === null ||
      patientUuid.trim() === ''
    ) {
      return undefined;
    }
    return {
      apiBase,
      sessionToken: handshake.sessionToken,
      patientUuid,
      conversationId: conversationExternalId,
    };
  }, [apiBase, handshake, conversationExternalId, patientUuid]);

  /**
   * Synchronous in-flight guard. State updates from `setBriefStatus` are
   * batched by React, so two effect runs in the same tick (notably
   * StrictMode's intentional double-mount in dev) can both observe
   * `kind === 'idle'` before either commits the `loading` transition.
   * This ref flips synchronously and is the source of truth for "do not
   * fire a second time within a single mount."
   */
  const briefInFlightRef = useRef(false);

  const runPresent = useCallback(async (): Promise<void> => {
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      return;
    }
    if (briefInFlightRef.current) {
      return;
    }
    briefInFlightRef.current = true;
    setBriefStatus({ kind: 'loading' });
    try {
      const out = await postPresentPatient(apiBase, handshake.sessionToken, patientUuid, false);
      const msg: ChatMessage = {
        role: 'assistant',
        blocks: out.blocks,
        citation_navigation: out.citation_navigation,
      };
      // Prepend so any messages typed/dictated during the brief aren't wiped.
      // The brief is still the first chronological turn of the conversation.
      setMessages((prev) => [msg, ...prev]);
      // Persist the rendered payload (NOT correlationId — that's a per-call
      // identifier and would cache-poison the next read with stale tracing
      // metadata). A re-mounted App for the same patient replays it without
      // a network round-trip.
      writeCachedBrief(patientUuid, { blocks: out.blocks, citation_navigation: out.citation_navigation });
      setBriefStatus({ kind: 'success' });
    } catch (err) {
      setBriefStatus({ kind: 'failed', error: toDeliveryFailure(err) });
    } finally {
      briefInFlightRef.current = false;
    }
  }, [apiBase, handshake, patientUuid]);

  /**
   * The single brief auto-trigger. Runs once per (patient, mount) when the
   * handshake reaches `ready`. The state-machine guard means it stays at
   * its terminal state (`success` / `cached` / `failed`) until something
   * resets it — so React StrictMode's intentional double-effect is a no-op
   * after the first run, and a transient `failed` state is recovered via
   * the explicit "Retry brief" button (which calls `runPresent` directly
   * after flipping the state back to `idle`).
   *
   * Replay-source priority (most-specific first):
   *   1. **conversation cache** — if the rail had any prior turns
   *      (typed/dictated user messages, proposal cards, follow-up
   *      assistant responses), seed the full message array verbatim.
   *      Supersedes the brief cache because the brief itself is part of
   *      that array and the conversation cache is the only source that
   *      preserves a resolved proposal card's `resolved` field across
   *      reload.
   *   2. **brief cache** — if there was no prior conversation but a
   *      previous mount had successfully fetched the brief, replay just
   *      that one assistant message. This is the common path on a
   *      second-tab open or a Refresh-chart reload immediately after the
   *      auto-fire.
   *   3. **runPresent** — first time this tab has seen this patient;
   *      hit `/present-patient` and prepend the resulting brief.
   */
  useEffect(() => {
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      return;
    }
    if (briefStatus.kind !== 'idle') {
      return;
    }

    const cachedConversation = readCachedConversation(patientUuid);
    if (cachedConversation !== null && cachedConversation.messages.length > 0) {
      // Spread to a mutable copy — the cache returns a readonly array
      // and `setMessages` is typed `ChatMessage[]`. The contents are
      // already the rendered payload, so no transformation is needed.
      setMessages([...cachedConversation.messages]);
      setBriefStatus({ kind: 'cached' });
      return;
    }

    // Cache replay path: the rail re-mounted the iframe (refresh-chart,
    // panel reload, pid-poll re-entry) but the server-side cache for
    // this (user_id, patient_uuid) almost certainly still has the brief.
    // Replaying from the per-tab payload cache paints the rail
    // immediately with no network round-trip and no flicker.
    const cached = readCachedBrief(patientUuid);
    if (cached !== null) {
      const msg: ChatMessage = {
        role: 'assistant',
        blocks: cached.blocks,
        citation_navigation: cached.citation_navigation,
      };
      setMessages((prev) => [msg, ...prev]);
      setBriefStatus({ kind: 'cached' });
      return;
    }

    void runPresent();
  }, [handshake.status, patientUuid, briefStatus.kind, runPresent]);

  /**
   * Persist the rail conversation on every change so a hard reload
   * (Refresh chart, panel remount, pid-poll re-entry) replays the full
   * dialog including resolved proposal cards. Mirrors the brief cache
   * pattern: keyed on `patient_uuid`, 2-hour TTL, 8-patient LRU,
   * fail-silent on quota / sessionStorage unavailability.
   *
   * Gate on `messages.length > 0` so the initial empty array on first
   * paint doesn't clobber a still-valid cache before the read effect
   * above has had a chance to seed it.
   */
  useEffect(() => {
    if (patientUuid === null || patientUuid === '' || messages.length === 0) {
      return;
    }
    writeCachedConversation(patientUuid, { messages });
  }, [messages, patientUuid]);

  /**
   * Stamp the matching proposal block's `resolved` field when a card
   * transitions to a terminal phase. The next run of the cache write
   * effect picks this up and persists it, so a reload after Confirm /
   * Decline replays the card already resolved (no re-active buttons,
   * no misleading "Rejected by OpenEMR" toast on a duplicate click).
   *
   * If the proposal id isn't found (defensive — shouldn't happen) the
   * update is a no-op rather than a throw.
   */
  const onProposalResolved = useCallback(
    (proposalId: string, resolution: ProposalResolution): void => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.role !== 'assistant') {
            return m;
          }
          let mutated = false;
          const nextBlocks = m.blocks.map((b) => {
            if (b.type === 'proposal' && b.proposal_id === proposalId) {
              mutated = true;
              return { ...b, resolved: resolution };
            }
            return b;
          });
          if (!mutated) {
            return m;
          }
          return { ...m, blocks: nextBlocks };
        }),
      );
      // G2-Final — tell the dashboard iframe to refresh its FHIR cache.
      // Only fires on accepted writes (declined / failed / openemr_denied
      // never landed in the chart so there's nothing to refresh).
      if (resolution.phase === 'accepted' && patientUuid !== null && patientUuid !== '') {
        broadcastProposalEvent({
          type: 'chart:updated',
          patient_uuid: patientUuid,
          source: 'cui',
        });
      }
    },
    [patientUuid],
  );

  /**
   * Phase 1 — FIFO queue of unresolved proposals. `head` is the oldest
   * unresolved proposal (the one the affordance renders + voice confirm
   * targets); `count` drives the "1 of N" indicator. Replaces the prior
   * inline LIFO useMemo that returned the freshest proposal regardless
   * of order, and that didn't filter `b.resolved` — both bugs fixed by
   * `findProposalQueue` (see proposal_lookup.ts).
   */
  const proposalQueue = useMemo(() => findProposalQueue(messages), [messages]);
  const activeProposal = proposalQueue.head;
  const queueCount = proposalQueue.count;

  /**
   * Phase 1 — head-only `proposal:open_modal` broadcast.
   *
   * The previous effect iterated every unresolved proposal and broadcast
   * for each, gated only by a per-id dedup set. With multiple allergy
   * proposals in flight that meant two `proposal:open_modal` events fired
   * with two different proposal_ids; the dashboard's `setAgentProposalId`
   * overwrites on the second event, leaving the modal pinned to the wrong
   * proposal even though the FIRST is still at the head of the queue.
   *
   * The new contract: fire once per head transition, only when the new
   * head is a target with a dashboard modal.
   *
   * Auto-open invariant: do not fire on the initial mount / cache replay.
   * The first run after mount registers the current head id without
   * broadcasting so the user sees the affordance and clicks into it
   * deliberately. Subsequent head changes (a new proposal arrives, or a
   * confirm/reject advances the queue) DO broadcast, so the modal opens
   * automatically as the queue progresses — matching the round-11 UX.
   */
  useEffect(() => {
    if (patientUuid === null || patientUuid === '') {
      return;
    }
    const headId = activeProposal?.proposalId ?? null;
    const headTarget = activeProposal?.writeTarget ?? null;

    // Phase 3 — broadcast a queue-state snapshot on every head change so
    // dashboard cards (AllergiesCard today; medication / demographics in
    // Phase 5) can disable their manual `+` button while an agent
    // proposal of the same target is queued. Fires on both initial mount
    // (so a chart that opens with a stale pending proposal disables the
    // `+` immediately) and subsequent transitions.
    broadcastProposalEvent({
      type: 'proposal:queue_state',
      head_id: headId,
      head_target: headTarget,
      count: queueCount,
    });

    if (!initialHeadCheckedRef.current) {
      initialHeadCheckedRef.current = true;
      lastBroadcastedHeadIdRef.current = headId;
      return;
    }
    if (headId === null) {
      lastBroadcastedHeadIdRef.current = null;
      return;
    }
    if (lastBroadcastedHeadIdRef.current === headId) {
      return;
    }
    lastBroadcastedHeadIdRef.current = headId;
    if (headTarget !== 'allergy') {
      return;
    }
    broadcastProposalEvent({
      type: 'proposal:open_modal',
      proposal_id: headId,
      write_target: headTarget,
      patient_uuid: patientUuid,
    });
  }, [activeProposal, patientUuid, queueCount]);

  /**
   * G2-Final — listen for `proposal:resolved` from the dashboard's
   * AllergyModal. When the physician saves (or the modal observes a
   * status_changed: rejected SSE event), the dashboard broadcasts this
   * event so the CUI can mark the matching proposal block as resolved.
   * Without it, the above-composer affordance kept rendering after a
   * dashboard-side save because the CUI had no other way to know the
   * proposal had landed (it never went through the CUI's own confirm
   * path).
   */
  useEffect(() => {
    return subscribeProposalEvents((event) => {
      if (event.type !== 'proposal:resolved') {
        return;
      }
      onProposalResolved(
        event.proposal_id,
        event.outcome === 'confirmed' ? { phase: 'accepted' } : { phase: 'declined' },
      );
    });
  }, [onProposalResolved]);

  /**
   * G2-Final — above-composer Confirm. Routes through the same
   * `postProposalConfirm` the in-chat ProposalBlock uses, so the server
   * path is identical (apply_pending_write.ts → write/allergy.php → addList).
   */
  const onAffordanceConfirm = useCallback((): void => {
    if (activeProposal === null || proposalEnv === undefined) {
      return;
    }
    setAffordanceState('submitting');
    setAffordanceError(null);
    void (async () => {
      try {
        const result = await postProposalConfirm(
          proposalEnv.apiBase,
          proposalEnv.sessionToken,
          proposalEnv.patientUuid,
          proposalEnv.conversationId,
          activeProposal.proposalId,
        );
        if (result.accepted) {
          onProposalResolved(activeProposal.proposalId, { phase: 'accepted' });
          setAffordanceState('idle');
        } else {
          setAffordanceState('failed');
          setAffordanceError(result.reason ?? 'OpenEMR rejected the write.');
          onProposalResolved(activeProposal.proposalId, {
            phase: 'openemr_denied',
            ...(result.reason !== undefined ? { openemrReason: result.reason } : {}),
          });
        }
      } catch (e) {
        setAffordanceState('failed');
        const msg = e instanceof AgentForgeDeliveryError ? e.kind : 'Save failed.';
        setAffordanceError(msg);
      }
    })();
  }, [activeProposal, proposalEnv, onProposalResolved]);

  const onAffordanceReject = useCallback((): void => {
    if (activeProposal === null || proposalEnv === undefined) {
      return;
    }
    setAffordanceState('submitting');
    setAffordanceError(null);
    void (async () => {
      try {
        await postProposalReject(
          proposalEnv.apiBase,
          proposalEnv.sessionToken,
          proposalEnv.patientUuid,
          proposalEnv.conversationId,
          activeProposal.proposalId,
        );
        onProposalResolved(activeProposal.proposalId, { phase: 'declined' });
        setAffordanceState('idle');
      } catch (e) {
        setAffordanceState('failed');
        const msg = e instanceof AgentForgeDeliveryError ? e.kind : 'Reject failed.';
        setAffordanceError(msg);
      }
    })();
  }, [activeProposal, proposalEnv, onProposalResolved]);

  /**
   * Phase 3 — clicking the affordance body routes to a target-appropriate
   * surface for reviewing the proposal:
   *
   *   - **Modal-bearing targets** (allergy today; medication / demographics
   *     in Phase 5): re-broadcast `proposal:open_modal` so the dashboard
   *     reopens the modal pre-populated with the proposal payload. Same
   *     event the round-11 broadcast effect fires on first arrival, so the
   *     modal binds via the same path whether it's first-open or
   *     post-snooze re-open.
   *   - **Modal-less targets** (vitals, vitals_delete, chief_complaint,
   *     chief_complaint_delete, clinical_note, clinical_note_update,
   *     clinical_note_delete, tobacco): no per-target dashboard modal
   *     exists yet, so navigate the OpenEMR shell to the bound encounter
   *     view — same NAV_REQUEST envelope the header "Today" link uses.
   *     The physician can review the existing chart values alongside the
   *     pending proposal in the affordance, then confirm/reject from
   *     there. Skipped silently when no encounter is bound (rail launched
   *     without one); the affordance Confirm/Reject buttons still work.
   *
   *   Targets without either path (none today; future writes that don't
   *   touch the encounter) fall through to a no-op.
   */
  const onAffordanceReopen = useCallback((): void => {
    if (activeProposal === null || patientUuid === null || patientUuid === '') {
      return;
    }
    const target = activeProposal.writeTarget;
    if (target === 'allergy') {
      broadcastProposalEvent({
        type: 'proposal:open_modal',
        proposal_id: activeProposal.proposalId,
        write_target: target,
        patient_uuid: patientUuid,
      });
      return;
    }
    const ENCOUNTER_TARGETS: ReadonlySet<string> = new Set([
      'vitals',
      'vitals_delete',
      'chief_complaint',
      'chief_complaint_delete',
      'clinical_note',
      'clinical_note_update',
      'clinical_note_delete',
      'tobacco',
    ]);
    if (ENCOUNTER_TARGETS.has(target) && boundEncounterId !== null) {
      requestEncounterNavigation(boundEncounterId, patientUuid);
    }
  }, [activeProposal, patientUuid, boundEncounterId]);

  const onDictationFinal = useCallback(
    async (text: string): Promise<void> => {
      const t = text.trim();
      if (t === '' || handshake.status !== 'ready') {
        return;
      }

      const prev = messagesRef.current;
      // Voice confirm targets the FIFO head of the unresolved queue (oldest
      // first, resolved blocks skipped), not whichever proposal arrived most
      // recently. Voice confirm with an empty queue is a no-op — the proposalId
      // is null and `tryConfirmProposalFromDictation` short-circuits.
      const proposalId = findProposalQueue(prev).head?.proposalId ?? null;
      const env = proposalEnv;

      // Paint the user turn immediately. The `[dictation]` prefix is gone — the
      // text is clean so the Agent API receives identical input to a typed send,
      // and the UI marks origin via `source: 'dictation'` for the MessageList badge.
      setMessages((p) => [...p, { role: 'user', blocks: [{ type: 'text', text: t }], source: 'dictation' }]);

      // Voice-confirm shortcut runs in parallel with /chat. Rationale: if the
      // physician dictates "yes, confirm" while a proposal card is open, we want
      // the card to accept right away (PRD §6.5.1 / Gate 5 G5-04) AND we still
      // want the agent to see the turn so a follow-up vitals/allergy line in
      // the same dictation isn't dropped on the floor.
      //
      // On voice-confirm success we *also* stamp the proposal block's
      // `resolved` field so a hard reload after the dictation replays
      // the card as already accepted. The "Accepted (voice)" surface
      // pill is purely a per-mount affordance via
      // `voiceCompletedProposalIds`; persisting through the resolved
      // field gracefully degrades to a plain "Accepted." pill on
      // remount, which is the correct truth (the server already wrote
      // the row).
      const voicePromise =
        env !== undefined && proposalId !== null ?
          tryConfirmProposalFromDictation(t, proposalId, env)
            .then((ok) => {
              if (ok) {
                setVoiceCompletedProposalIds((s) => new Set(s).add(proposalId));
                onProposalResolved(proposalId, { phase: 'accepted' });
              }
            })
            .catch(() => {
              /* voice path is best-effort */
            })
        : Promise.resolve();

      // Route dictation through the same /chat pipeline as typed messages so
      // the orchestrator, vitals parser, and proposal tools all fire. Without
      // this, dictating "BP 125/60" previously produced no proposal card while
      // typing the same string did.
      setSending(true);
      setRoutingLabel(null);
      setSendFailure(null);

      try {
        const onRouting = (event: { label: string }): void => {
          setRoutingLabel(event.label);
        };
        const chatOpts =
          conversationExternalId !== null && conversationExternalId.trim() !== '' ?
            { conversation_id: conversationExternalId, onRouting }
          : { onRouting };

        const { blocks, citation_navigation, conversationId } = await postChat(
          apiBase,
          handshake.sessionToken,
          patientUuid ?? '',
          t,
          chatOpts,
        );

        if (conversationId !== null && conversationId !== '') {
          setConversationExternalId(conversationId);
        }

        setMessages((p) => [...p, { role: 'assistant', blocks, citation_navigation }]);
      } catch (err) {
        setSendFailure(toDeliveryFailure(err));
      } finally {
        setSending(false);
        setRoutingLabel(null);
      }

      await voicePromise;
    },
    [apiBase, conversationExternalId, handshake, patientUuid, proposalEnv, onProposalResolved],
  );

  /**
   * G2-MVP-99 — handles both text-only and file-attached sends. When a
   * file is attached: upload to module first → then post to /chat with
   * `docref_uuid` + `doc_type` so the orchestrator routes through
   * `attach_and_extract`. The `attachment` ref rides along on the user
   * ChatMessage so the sent bubble can render the same preview chip.
   */
  async function onSubmit(e?: FormEvent): Promise<void> {
    e?.preventDefault();
    if (handshake.status !== 'ready') {
      return;
    }
    const text = input.trim();
    const file = attachedFile;
    if (text === '' && file === null) {
      return;
    }

    setSending(true);
    setRoutingLabel(null);
    setSendFailure(null);

    // Clear composer immediately so the user sees their turn paint
    // without the still-attached file lingering. Capture the file in
    // a local for the upload below.
    setInput('');
    setAttachedFile(null);

    // Paint user turn immediately. The attachment object rides on the
    // ChatMessage so the bubble can render the same preview chip used
    // in the composer (minus the X). MessageList opens DocumentModal
    // when the chip is clicked.
    const userMessage: ChatMessage =
      file !== null ?
        {
          role: 'user',
          blocks: text !== '' ? [{ type: 'text', text }] : [],
          attachment: { file, mimeType: file.type, name: file.name },
        }
      : { role: 'user', blocks: [{ type: 'text', text }] };
    setMessages((prev) => [...prev, userMessage]);

    try {
      let docrefUuid: string | undefined;
      let docType: 'lab_pdf' | 'intake_form' | undefined;

      if (file !== null) {
        // Heuristic doc-type routing for the MVP demo. Filename hints
        // ("lab", "lipid", "panel", "cbc", "cmp") mark labs; everything
        // else routes to intake_form. The brief's MVP is the two doc
        // types only.
        const lowerName = file.name.toLowerCase();
        const looksLikeLab =
          /\b(lab|lipid|panel|cbc|cmp|hba1c|a1c|glucose|metabolic|chemistry|cholesterol)\b/.test(lowerName);
        docType = looksLikeLab ? 'lab_pdf' : 'intake_form';

        const upload = await postUploadDocument(
          moduleBase,
          handshake.sessionToken,
          patientUuid ?? '',
          docType,
          file,
        );
        docrefUuid = upload.docrefUuid;

        // Stamp the docref + OpenEMR document mapping onto the user
        // message's attachment so the chip becomes clickable (image
        // preview opens DocumentModal/bbox; the post-extraction link
        // uses oeDocumentId to navigate to OpenEMR's Documents tab).
        // Match by File reference identity — the user message we just
        // appended is the only one carrying this exact File object.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.role !== 'user' || m.attachment?.file !== file) {
              return m;
            }
            return {
              ...m,
              attachment: {
                ...m.attachment,
                docrefUuid: upload.docrefUuid,
                ...(upload.oeDocumentId !== null ? { oeDocumentId: upload.oeDocumentId } : {}),
                ...(upload.oePatientPid !== null ? { oePatientPid: upload.oePatientPid } : {}),
              },
            };
          }),
        );
      }

      const chatOpts: {
        conversation_id?: string;
        docref_uuid?: string;
        doc_type?: 'lab_pdf' | 'intake_form';
        onRouting?: (event: { worker: 'intake_extractor' | 'evidence_retriever'; label: string }) => void;
      } = {
        onRouting: (event) => {
          setRoutingLabel(event.label);
        },
      };
      if (conversationExternalId !== null && conversationExternalId.trim() !== '') {
        chatOpts.conversation_id = conversationExternalId;
      }
      if (docrefUuid !== undefined) {
        chatOpts.docref_uuid = docrefUuid;
      }
      if (docType !== undefined) {
        chatOpts.doc_type = docType;
      }

      // For file-only sends, give the orchestrator a sane prompt so the
      // model has something to act on alongside the docref.
      const messageForChat =
        text !== '' ? text
        : docType === 'lab_pdf' ? 'Please read this lab and tell me what you found.'
        : 'Please read this intake form and tell me what you found.';

      const { blocks, citation_navigation, conversationId } = await postChat(
        apiBase,
        handshake.sessionToken,
        patientUuid ?? '',
        messageForChat,
        chatOpts,
      );

      if (conversationId !== null && conversationId !== '') {
        setConversationExternalId(conversationId);
      }

      setMessages((prev) => [...prev, { role: 'assistant', blocks, citation_navigation }]);
    } catch (err) {
      setSendFailure(toDeliveryFailure(err));
    } finally {
      setSending(false);
      setRoutingLabel(null);
    }
  }

  /**
   * G2-Final-31 (parent-overlay variant) — document preview is rendered
   * by the OpenEMR shell as a top-level overlay, not by the CUI iframe.
   * Posting `AGENTFORGE_OPEN_DOCUMENT_OVERLAY` to the parent with the
   * fully-resolved bytes URL lets the host create an overlay that sits
   * over both the OpenEMR app AND the CUI rail without disturbing
   * either layout. The host renders the PDF via a nested iframe with
   * the browser's native PDF viewer (no pdfjs needed in the parent),
   * which sidesteps the buffer-detach bug we hit when reusing cached
   * Uint8Array bytes through pdfjs across multiple opens.
   */
  const onOpenDocument = useCallback((docrefUuid: string, page?: number): void => {
    if (typeof window.parent === 'undefined' || window.parent === null) {
      return;
    }
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      return;
    }
    const bytesUrl = new URL(`${moduleBase}/document/bytes.php`, window.location.origin);
    bytesUrl.searchParams.set('docref_uuid', docrefUuid);
    bytesUrl.searchParams.set('session_token', handshake.sessionToken);
    bytesUrl.searchParams.set('patient_uuid', patientUuid);
    window.parent.postMessage(
      {
        type: 'AGENTFORGE_OPEN_DOCUMENT_OVERLAY',
        bytes_url: bytesUrl.toString(),
        docref_uuid: docrefUuid,
        initial_page: page ?? 1,
      },
      window.location.origin,
    );
  }, [moduleBase, handshake, patientUuid]);

  /**
   * Post-extraction "View in documents" link — asks the host shell to
   * navigate the chart's main content area to the canonical OpenEMR
   * Document viewer for this file (same destination as a clinician
   * double-clicking the document inside the Documents tab). Mirrors the
   * existing `requestEncounterNavigation` / `requestVisitHistoryNavigation`
   * pattern: post a NAV_REQUEST hint to the parent rail container, which
   * owns the `top.navigateTab(...)` plumbing.
   *
   * Looks up the OpenEMR `documents.id` + numeric pid from the user
   * message that owns this docref (stamped by the upload-success path).
   * Falls back to the in-rail bbox modal when the OpenEMR-side ids are
   * missing — this happens when the upload predates the registrar
   * projection (legacy `agentforge_w2/`-only uploads).
   */
  const onViewInDocuments = useCallback((docrefUuid: string): void => {
    const match = messages.find(
      (m) => m.attachment?.docrefUuid === docrefUuid && m.attachment?.oeDocumentId !== undefined,
    );
    const oeDocId = match?.attachment?.oeDocumentId;
    const pid = match?.attachment?.oePatientPid;
    if (oeDocId === undefined || pid === undefined) {
      onOpenDocument(docrefUuid, 1);
      return;
    }
    if (typeof window.parent === 'undefined' || window.parent === null) {
      return;
    }
    if (patientUuid === null || patientUuid === '') {
      return;
    }
    window.parent.postMessage(
      {
        type: 'NAV_REQUEST',
        hint: {
          kind: 'document',
          params: { document_id: oeDocId, patient_pid: pid },
        },
        expected_patient_uuid: patientUuid,
      },
      window.location.origin,
    );
  }, [messages, onOpenDocument, patientUuid]);

  // G2-MVP-99 — file attachment plumbing. Validation matches the W2
  // brief: PDF/PNG/JPEG only, 10 MB cap. Errors surface as `attachError`
  // (auto-cleared on next valid pick).
  const acceptFile = useCallback((f: File | null): void => {
    if (f === null) {
      setAttachedFile(null);
      return;
    }
    const result = validateFileBasic(f);
    if (!result.ok) {
      setAttachError(result.errorMessage);
      return;
    }
    setAttachError(null);
    setAttachedFile(f);
  }, []);

  const onPickFile = useCallback((e: ChangeEvent<HTMLInputElement>): void => {
    acceptFile(e.target.files?.[0] ?? null);
    e.target.value = '';
  }, [acceptFile]);

  const onComposeDrop = useCallback((e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  }, [acceptFile]);

  function refreshChartBinding(): void {
    // P5 fix (Bug B, third pass): two prior implementations were wrong.
    //
    // Pass 1: `window.location.reload()` — re-mounted the iframe, ran panel.php
    // which minted a new one-time launch code; under transient conditions the
    // redeem failed and the rail rendered nothing visible.
    //
    // Pass 2: soft-reset via `setBriefStatus({ kind: 'idle' })` — bumped the
    // brief auto-fetch effect to re-run, but that effect's first branch
    // replays the cached conversation (line 404: setMessages([...cached])),
    // which (a) didn't visibly refresh anything because the data was the
    // same, and (b) clobbered live in-memory state (such as a user message's
    // alive `attachment.file`) with the cache-stripped version (where File
    // objects coerce to `{}` under JSON.stringify), then crashed in
    // AttachmentPreview.
    //
    // Pass 3 (this one): bypass the cache-replay path entirely. Show a
    // loading state immediately, fetch a fresh brief with forceRefresh=true,
    // and replace just the brief message in-place — preserving every other
    // message in the thread (typed turns, proposal cards, attachments with
    // live File objects). No state-machine roundtrip, no cache replay, no
    // remount.
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      // Pre-handshake / error-state escape hatch. Hard reload is the only
      // recovery; the launch code is invalid anyway so re-redemption is
      // the desired outcome.
      window.location.reload();
      return;
    }
    if (briefInFlightRef.current) {
      // Already refreshing — let the in-flight one finish.
      return;
    }
    // P5 fix (Bug B, fourth pass / 2026-05-07 polish): do NOT set briefStatus
    // to 'loading' on refresh. That state drives the "Preparing case
    // presentation…" hint (line 955), which is appropriate for the first-load
    // path (when there's nothing in messages yet) but reads as
    // "we're throwing the existing brief away" on a refresh, where the brief
    // is already visible in the thread. Refresh updates the message in-place
    // when the fetch resolves; the brief content's change IS the visual
    // signal. On error we also do NOT flip briefStatus to 'failed' — the
    // existing brief is still valid and useful, refreshing failed silently
    // is the correct degradation. briefInFlightRef is the only reentry
    // guard needed; briefStatus stays in whatever success/cached state it
    // was already in.
    briefInFlightRef.current = true;
    void (async () => {
      try {
        const out = await postPresentPatient(apiBase, handshake.sessionToken, patientUuid, true);
        const fresh: ChatMessage = {
          role: 'assistant',
          blocks: out.blocks,
          citation_navigation: out.citation_navigation,
        };
        // Replace the first message (the brief — always prepended at line
        // 356 / 425) in-place; preserve everything after it. Edge case: if
        // the user somehow got into a state with no assistant brief at
        // index 0 (shouldn't happen — auto-effect prepends — but defensive),
        // just prepend.
        setMessages((prev) => {
          if (prev[0]?.role === 'assistant') {
            return [fresh, ...prev.slice(1)];
          }
          return [fresh, ...prev];
        });
        writeCachedBrief(patientUuid, { blocks: out.blocks, citation_navigation: out.citation_navigation });
      } catch {
        // Silent fail — the existing brief in `messages` stays put, so the
        // user keeps a usable rail. They can click refresh again or check
        // network. We don't surface a "failed" banner because that would
        // cover the still-valid brief beneath it.
      } finally {
        briefInFlightRef.current = false;
      }
    })();
  }

  function reloadPanel(): void {
    // Pre-handshake / error-state escape hatch. No cache-bust call — the
    // session token isn't valid yet — just a page reload so the operator
    // can recover from a stuck "Connecting…" or stale error message.
    window.location.reload();
  }

  /**
   * Header chrome bar — gray bar with title everywhere. On the chart-required
   * empty screen (no_chart / no patient context) the refresh control is
   * omitted (nothing to refresh yet), but we still reserve the same action
   * column width/height as the real button so the header bar does not jump
   * when a patient becomes active.
   *
   * When the control is shown: handshake-ready uses cache-busting
   * `refreshChartBinding`; loading / handshake error uses plain
   * `reloadPanel`. `aria-label` is the sole visible affordance name
   * (no `title` — matches OpenEMR tab chrome).
   */
  const headerIsReady = handshake.status === 'ready';
  // The patient label (name/age/sex from server-side `agentforge_patient_copilot_header_title`)
  // is only meaningful as a Dashboard link when both a copilot title and a bound patient UUID
  // are present. Default "Clinical Copilot" stays plain text.
  const titleIsPatientLink =
    copilotTitle !== null && patientUuid !== null && patientUuid !== '';
  // "Today" link is meaningful only when a chart is bound AND the
  // AppointmentEncounterBinder picked an encounter at panel render time —
  // without one there's nothing to navigate to.
  const todayIsAvailable =
    titleIsPatientLink && boundEncounterId !== null;
  const renderPanelHeader = (showRefresh: boolean): ReactElement => (
    <header className="agentforge-cui__header">
      <div className="agentforge-cui__title-group">
        <h1 className="agentforge-cui__title">
          {titleIsPatientLink ?
            <button
              type="button"
              className="agentforge-cui__title-link"
              onClick={() => requestPatientDashboardNavigation(patientUuid)}
              title="Open patient dashboard"
            >
              {headerTitle}
            </button>
          : headerTitle}
        </h1>
        {todayIsAvailable ?
          <button
            type="button"
            className="agentforge-cui__today-button"
            onClick={() => requestEncounterNavigation(boundEncounterId, patientUuid)}
            title="Open today's encounter"
          >
            Today
          </button>
        : null}
      </div>
      {showRefresh ?
        <div className="agentforge-cui__header-actions">
          {titleIsPatientLink ?
            <button
              type="button"
              className="agentforge-cui__refresh"
              onClick={() => requestVisitHistoryNavigation(patientUuid)}
              aria-label="Open visit history"
              title="Visit history"
            >
              <IconVisitHistory />
            </button>
          : null}
          <button
            type="button"
            className="agentforge-cui__refresh"
            onClick={headerIsReady ? refreshChartBinding : reloadPanel}
            aria-label={headerIsReady ? 'Refresh clinical copilot' : 'Reload clinical copilot panel'}
          >
            <IconPanelSync />
          </button>
        </div>
      : <span className="agentforge-cui__header-action-slot" aria-hidden="true" />}
    </header>
  );

  if (handshake.status === 'error') {
    const isNoChart =
      handshake.message === 'no_chart_bound' || handshake.message === 'no_patient_context';
    return (
      <main className="agentforge-cui">
        {renderPanelHeader(!isNoChart)}
        <section className="agentforge-cui__empty" aria-labelledby="agentforge-cui-empty-title">
          <span className="agentforge-cui__empty-glyph" aria-hidden="true">
            {/* Stethoscope-ish glyph: chestpiece + tubing curve. Communicates
                "clinical assistant waiting on a chart" without leaning on
                a generic chat-bot bubble. */}
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 8v9a8 8 0 0 0 16 0V8" />
              <path d="M22 25v6a8 8 0 0 0 16 0v-3" />
              <circle cx="38" cy="22" r="3" />
            </svg>
          </span>
          {isNoChart ? (
            <>
              <h2 id="agentforge-cui-empty-title" className="agentforge-cui__empty-title">
                Open a patient chart to begin.
              </h2>
              <p className="agentforge-cui__empty-body">
                Clinical Copilot needs an active chart to read or propose anything.
              </p>
            </>
          ) : (
            <>
              <h2 id="agentforge-cui-empty-title" className="agentforge-cui__empty-title">
                Unable to start session.
              </h2>
              <p className="agentforge-cui__empty-body">
                {handshake.message === 'missing_api_base'
                  ? 'Agent API URL is not configured (set AGENTFORGE_API_PUBLIC_URL for PHP).'
                  : 'Refresh the chart page or contact an administrator.'}
              </p>
            </>
          )}
        </section>
      </main>
    );
  }

  if (handshake.status === 'loading' || handshake.status === 'idle') {
    return (
      <main className="agentforge-cui">
        {renderPanelHeader(true)}
        <section className="agentforge-cui__empty" aria-labelledby="agentforge-cui-loading-title">
          <span className="agentforge-cui__empty-spinner" aria-hidden="true" />
          <h2 id="agentforge-cui-loading-title" className="agentforge-cui__empty-title">
            Connecting…
          </h2>
          <p className="agentforge-cui__empty-body">
            Loading your patient context.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="agentforge-cui">
      {renderPanelHeader(true)}
      {presenting ? <StatusLabel label="Generating summary" /> : null}
      <MessageList
        messages={messages}
        boundPatientUuid={patientUuid}
        {...(proposalEnv !== undefined ? { proposalEnv } : {})}
        voiceCompletedProposalIds={voiceCompletedProposalIds}
        onProposalResolved={onProposalResolved}
        onOpenDocument={onOpenDocument}
        onViewInDocuments={onViewInDocuments}
        typing={sending}
        routingLabel={routingLabel}
      />
      {briefStatus.kind === 'failed' ? (
        <div className="agentforge-cui__brief-failed" role="alert">
          <p className="agentforge-cui__error">
            Could not load the case presentation. {describeSendFailure(briefStatus.error)}
          </p>
          <button
            type="button"
            className="agentforge-cui__retry-brief"
            onClick={() => {
              setBriefStatus({ kind: 'idle' });
            }}
          >
            Retry brief
          </button>
        </div>
      ) : null}
      {sendFailure !== null ? (
        <p className="agentforge-cui__error" role="alert">
          {describeSendFailure(sendFailure)}
        </p>
      ) : null}
      {micError !== null ? (
        <p className="agentforge-cui__error" role="alert">
          {micError}
        </p>
      ) : null}
      {attachError !== null ? (
        <p className="agentforge-cui__error" role="alert">
          {attachError}
        </p>
      ) : null}
      {activeProposal !== null && proposalEnv !== undefined ? (
        <div className="agentforge-cui__above-composer-stack">
          {queueCount > 1 ? (
            <div
              className="agentforge-cui__above-composer-counter"
              data-testid="above-composer-counter"
              aria-live="polite"
            >
              1 of {queueCount}
            </div>
          ) : null}
          <AboveComposerAffordance
            /* Phase 1 — keying on `proposalId` triggers a fresh mount on head
               change, so the next head fades in via the affordance's CSS
               animation rather than swapping content in place. */
            key={activeProposal.proposalId}
            proposalId={activeProposal.proposalId}
            writeTarget={activeProposal.writeTarget}
            preview={activeProposal.preview}
            state={affordanceState}
            {...(affordanceError !== null ? { errorMessage: affordanceError } : {})}
            onConfirm={onAffordanceConfirm}
            onReject={onAffordanceReject}
            onReopen={onAffordanceReopen}
          />
        </div>
      ) : null}
      <form
        className={`agentforge-cui__form agentforge-cui__compose${dragOver ? ' agentforge-cui__compose--drag' : ''}`}
        onSubmit={(ev) => void onSubmit(ev)}
      >
        <label htmlFor="agentforge-message" className="visually-hidden">
          Message
        </label>
        <div
          className="agentforge-cui__compose-input-wrap"
          onDragOver={(ev) => {
            ev.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onComposeDrop}
        >
          {/* iMessage-style: attachment chip and `+` share the same
              absolute top-left position inside the textarea wrap and are
              mutually exclusive. Single-attachment-at-a-time = no
              affordance to add a second file once one is staged. */}
          {attachedFile !== null ? (
            <div className="agentforge-cui__compose-inline-slot">
              <AttachmentPreview
                file={attachedFile}
                onRemove={() => setAttachedFile(null)}
                compact
              />
            </div>
          ) : (
            <button
              type="button"
              className="agentforge-cui__compose-inline-slot agentforge-cui__compose-attach"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a lab or intake PDF"
              title="Attach a lab or intake PDF"
              disabled={sending}
            >
              <IconPlus />
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            style={{ display: 'none' }}
            onChange={onPickFile}
            data-testid="agentforge-attach-input"
          />
          <textarea
            ref={composeInputRef}
            id="agentforge-message"
            className="agentforge-cui__input agentforge-cui__input--with-attach"
            rows={3}
            value={input}
            disabled={sending}
            placeholder="Ask about this patient, or drop a lab / intake PDF."
            onChange={(ev) => setInput(ev.target.value)}
          />
        </div>
        <div className="agentforge-cui__compose-actions">
          <button
            type="submit"
            className="agentforge-cui__send"
            disabled={sending || (input.trim() === '' && attachedFile === null)}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
          <MicControl
            apiBase={apiBase}
            sessionToken={handshake.sessionToken}
            patientUuid={patientUuid ?? ''}
            conversationExternalId={conversationExternalId}
            disabled={sending}
            onFinalTranscript={(t) => void onDictationFinal(t)}
            onLocalError={setMicError}
          />
        </div>
      </form>
      {/* G2-Final-FB-A-05 / FB-A-06 — health-check footer pills. New
          render slot, does not displace any existing CUI affordance. */}
      <div
        className="agentforge-cui__footer"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '0.4rem 0.6rem',
          borderTop: '1px solid rgba(0,0,0,0.06)',
          position: 'relative',
        }}
      >
        <PhiRedactionBadge apiBase={apiBase} />
        <EvalGateBadge apiBase={apiBase} />
      </div>
    </main>
  );
}
