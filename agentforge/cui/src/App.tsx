import type { FormEvent, ReactElement } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AgentForgeDeliveryError, postChat, postPresentPatient } from './api/client.js';
import { readCachedBrief, writeCachedBrief } from './chat/brief_cache.js';
import { readCachedConversation, writeCachedConversation } from './chat/conversation_cache.js';
import { MessageList, type ChatMessage, type ProposalApiEnv } from './chat/MessageList.js';
import { findLatestOpenProposalId } from './chat/proposal_lookup.js';
import { tryConfirmProposalFromDictation } from './chat/voice_confirm_proposal.js';
import { useHandshake } from './chat/useHandshake.js';
import MicControl from './recording/MicControl.js';
import { readApiBase } from './config.js';
import type { ProposalResolution } from './types/chat.js';

function readDocumentHints(): { launchCode: string | null; patientUuid: string | null } {
  const root = document.documentElement;
  const launch = root.getAttribute('data-launch-code');
  const patient = root.getAttribute('data-patient-uuid');
  return {
    launchCode: launch !== null && launch !== '' ? launch : null,
    patientUuid: patient !== null && patient !== '' ? patient : null,
  };
}

function newConversationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cui-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
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

export default function App(): ReactElement {
  const { launchCode, patientUuid } = useMemo(() => readDocumentHints(), []);
  const handshake = useHandshake(launchCode, patientUuid);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationExternalId, setConversationExternalId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [briefStatus, setBriefStatus] = useState<BriefStatus>({ kind: 'idle' });
  const [sendFailure, setSendFailure] = useState<AgentForgeDeliveryError | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [voiceCompletedProposalIds, setVoiceCompletedProposalIds] = useState(() => new Set<string>());

  // Loading hint is a derivation of the state machine, not an independent
  // boolean — the two used to drift apart on transient failures.
  const presenting = briefStatus.kind === 'loading';

  const apiBase = useMemo(() => readApiBase(), []);
  const messagesRef = useRef<ChatMessage[]>([]);
  const composeInputRef = useRef<HTMLTextAreaElement>(null);
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
    },
    [],
  );

  const onDictationFinal = useCallback(
    async (text: string): Promise<void> => {
      const t = text.trim();
      if (t === '' || handshake.status !== 'ready') {
        return;
      }

      const prev = messagesRef.current;
      const proposalId = findLatestOpenProposalId(prev);
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
      setSendFailure(null);

      try {
        const chatOpts =
          conversationExternalId !== null && conversationExternalId.trim() !== '' ?
            { conversation_id: conversationExternalId }
          : undefined;

        const { blocks, citation_navigation, conversationId } =
          chatOpts !== undefined ?
            await postChat(apiBase, handshake.sessionToken, patientUuid ?? '', t, chatOpts)
          : await postChat(apiBase, handshake.sessionToken, patientUuid ?? '', t);

        if (conversationId !== null && conversationId !== '') {
          setConversationExternalId(conversationId);
        }

        setMessages((p) => [...p, { role: 'assistant', blocks, citation_navigation }]);
      } catch (err) {
        setSendFailure(toDeliveryFailure(err));
      } finally {
        setSending(false);
      }

      await voicePromise;
    },
    [apiBase, conversationExternalId, handshake, patientUuid, proposalEnv, onProposalResolved],
  );

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (text === '' || handshake.status !== 'ready') {
      return;
    }

    setSending(true);
    setSendFailure(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', blocks: [{ type: 'text', text }] }]);

    try {
      const chatOpts =
        conversationExternalId !== null && conversationExternalId.trim() !== '' ?
          { conversation_id: conversationExternalId }
        : undefined;

      const { blocks, citation_navigation, conversationId } =
        chatOpts !== undefined ?
          await postChat(apiBase, handshake.sessionToken, patientUuid ?? '', text, chatOpts)
        : await postChat(apiBase, handshake.sessionToken, patientUuid ?? '', text);

      if (conversationId !== null && conversationId !== '') {
        setConversationExternalId(conversationId);
      }

      setMessages((prev) => [...prev, { role: 'assistant', blocks, citation_navigation }]);
    } catch (err) {
      setSendFailure(toDeliveryFailure(err));
    } finally {
      setSending(false);
    }
  }

  function refreshChartBinding(): void {
    // P3 fix: a plain `window.location.reload()` re-mounts the iframe but does
    // NOT bust the agent-side 2-hour brief cache, so an operator who saw a
    // blank/stale brief and clicked Refresh would get the same blank brief
    // back. Fire a `force_refresh` present-patient first so the API drops the
    // cached entry for this (patient, encounter, sessionToken) tuple. This is
    // fire-and-forget — failures are tolerated silently because the reload
    // that follows will retry from a clean iframe mount anyway.
    if (handshake.status === 'ready' && patientUuid !== null && patientUuid !== '') {
      void postPresentPatient(apiBase, handshake.sessionToken, patientUuid, true).catch(() => {
        /* ignore — the reload below is the user-visible recovery path */
      });
    }
    window.location.reload();
  }

  function reloadPanel(): void {
    // Pre-handshake / error-state escape hatch. No cache-bust call — the
    // session token isn't valid yet — just a page reload so the operator
    // can recover from a stuck "Connecting…" or stale error message.
    window.location.reload();
  }

  /**
   * Header chrome bar — gray bar with title everywhere. Refresh is omitted
   * only for the chart-required empty screen (no_chart / no patient
   * context): there is nothing to refresh yet, and removing the secondary
   * action keeps parity with PR5 chrome + white canvas framing.
   *
   * When the control is shown: handshake-ready uses cache-busting
   * `refreshChartBinding`; loading / handshake error uses plain
   * `reloadPanel`. `aria-label` is the sole visible affordance name
   * (no `title` — matches OpenEMR tab chrome).
   */
  const headerIsReady = handshake.status === 'ready';
  const renderPanelHeader = (showRefresh: boolean): ReactElement => (
    <header className="agentforge-cui__header">
      <h1 className="agentforge-cui__title">Clinical Co-Pilot</h1>
      {showRefresh ? (
        <button
          type="button"
          className="agentforge-cui__refresh"
          onClick={headerIsReady ? refreshChartBinding : reloadPanel}
          aria-label={headerIsReady ? 'Refresh clinical co-pilot' : 'Reload clinical co-pilot panel'}
        >
          <IconPanelSync />
        </button>
      ) : null}
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
                AgentForge needs an active chart to read or propose anything.
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
      {presenting ? <p className="agentforge-cui__hint">Preparing case presentation…</p> : null}
      <MessageList
        messages={messages}
        boundPatientUuid={patientUuid}
        {...(proposalEnv !== undefined ? { proposalEnv } : {})}
        voiceCompletedProposalIds={voiceCompletedProposalIds}
        onProposalResolved={onProposalResolved}
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
              // Flip back to idle; the auto-trigger effect re-fires on the
              // next tick. Going through `idle` (rather than calling
              // `runPresent` directly) preserves the cache-replay path —
              // if a previous successful brief was written to
              // sessionStorage in another mount, this will replay it
              // instead of forcing a new LLM call.
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
      <form className="agentforge-cui__form agentforge-cui__compose" onSubmit={(ev) => void onSubmit(ev)}>
        <label htmlFor="agentforge-message" className="visually-hidden">
          Message
        </label>
        <textarea
          ref={composeInputRef}
          id="agentforge-message"
          className="agentforge-cui__input"
          rows={3}
          value={input}
          disabled={sending}
          placeholder="Ask about this patient or dictate clinical updates…"
          onChange={(ev) => setInput(ev.target.value)}
        />
        <div className="agentforge-cui__compose-actions">
          <button type="submit" className="agentforge-cui__send" disabled={sending || input.trim() === ''}>
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
    </main>
  );
}
