import type { FormEvent, ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentForgeDeliveryError, getConversationRecap, postChat, postPresentPatient } from './api/client.js';
import { markBriefFired, readBriefAlreadyFired } from './chat/brief_dedupe.js';
import { MessageList, type ChatMessage, type ProposalApiEnv } from './chat/MessageList.js';
import { findLatestOpenProposalId } from './chat/proposal_lookup.js';
import { tryConfirmProposalFromDictation } from './chat/voice_confirm_proposal.js';
import { useHandshake } from './chat/useHandshake.js';
import MicControl from './recording/MicControl.js';
import { readApiBase } from './config.js';

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

const BRIEF_ME_TRIGGER = /^(brief me|case presentation|present (?:the )?patient)\b/i;

const RECAP_TRIGGER = /^(what did we capture|visit recap|capture summary)\b/i;

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

export default function App(): ReactElement {
  const { launchCode, patientUuid } = useMemo(() => readDocumentHints(), []);
  const handshake = useHandshake(launchCode, patientUuid);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationExternalId, setConversationExternalId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [sendFailure, setSendFailure] = useState<AgentForgeDeliveryError | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [voiceCompletedProposalIds, setVoiceCompletedProposalIds] = useState(() => new Set<string>());

  const apiBase = useMemo(() => readApiBase(), []);
  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  const pendingPresentRef = useRef(false);
  // Two-layer dedupe for the auto-fire brief, because the rail container can
  // schedule AGENTFORGE_PRESENT_PATIENT multiple times AND can re-mount this
  // iframe (pid-probe interval, refresh-chart, re-handshake):
  //   1. briefAutoFiredRef — in-memory; protects against multiple pings hitting
  //      a single mount before the brief returns.
  //   2. sessionStorage marker keyed by patient_uuid — survives iframe reloads
  //      so a re-mounted App for the same patient does NOT auto-fire a second
  //      brief. The user can still trigger fresh briefs explicitly via the
  //      "brief me" / "case presentation" command.
  const briefAutoFiredRef = useRef(false);

  const runPresent = useCallback(async () => {
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      return;
    }

    setPresenting(true);
    setSendFailure(null);
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
    } catch (err) {
      setSendFailure(toDeliveryFailure(err));
    } finally {
      setPresenting(false);
    }
  }, [apiBase, handshake, patientUuid]);

  useEffect(() => {
    function onMessage(ev: MessageEvent): void {
      if (ev.origin !== window.location.origin) {
        return;
      }
      const d = ev.data;
      if (!d || typeof d !== 'object' || (d as { type?: unknown }).type !== 'AGENTFORGE_PRESENT_PATIENT') {
        return;
      }

      if (briefAutoFiredRef.current) {
        return;
      }

      if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
        pendingPresentRef.current = true;
        return;
      }

      if (readBriefAlreadyFired(patientUuid)) {
        briefAutoFiredRef.current = true;
        return;
      }

      briefAutoFiredRef.current = true;
      markBriefFired(patientUuid);
      void runPresent();
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [handshake.status, patientUuid, runPresent]);

  useEffect(() => {
    if (handshake.status !== 'ready' || patientUuid === null || patientUuid === '') {
      return;
    }

    if (!pendingPresentRef.current || briefAutoFiredRef.current) {
      return;
    }

    pendingPresentRef.current = false;
    briefAutoFiredRef.current = true;

    if (readBriefAlreadyFired(patientUuid)) {
      return;
    }

    markBriefFired(patientUuid);
    void runPresent();
  }, [handshake.status, patientUuid, runPresent]);

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
      const voicePromise =
        env !== undefined && proposalId !== null ?
          tryConfirmProposalFromDictation(t, proposalId, env)
            .then((ok) => {
              if (ok) {
                setVoiceCompletedProposalIds((s) => new Set(s).add(proposalId));
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
    [apiBase, conversationExternalId, handshake, patientUuid, proposalEnv],
  );

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (text === '' || handshake.status !== 'ready') {
      return;
    }

    const isBriefMe = BRIEF_ME_TRIGGER.test(text);
    if (isBriefMe) {
      setSending(true);
      setSendFailure(null);
      setInput('');
      setMessages((prev) => [...prev, { role: 'user', blocks: [{ type: 'text', text }] }]);
      try {
        const out = await postPresentPatient(apiBase, handshake.sessionToken, patientUuid ?? '', false);
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', blocks: out.blocks, citation_navigation: out.citation_navigation },
        ]);
      } catch (err) {
        setSendFailure(toDeliveryFailure(err));
      } finally {
        setSending(false);
      }
      return;
    }

    if (RECAP_TRIGGER.test(text)) {
      setSending(true);
      setSendFailure(null);
      setInput('');
      if (conversationExternalId === null || conversationExternalId.trim() === '') {
        setMessages((prev) => [
          ...prev,
          { role: 'user', blocks: [{ type: 'text', text }] },
          {
            role: 'assistant',
            blocks: [
              { type: 'text', text: 'No visit thread yet — send a chart message first, then ask for a recap.' },
            ],
          },
        ]);
        setSending(false);
        return;
      }
      setMessages((prev) => [...prev, { role: 'user', blocks: [{ type: 'text', text }] }]);
      try {
        const r = await getConversationRecap(apiBase, handshake.sessionToken, patientUuid ?? '', conversationExternalId);
        setMessages((prev) => [...prev, { role: 'assistant', blocks: [{ type: 'recap', items: r.items }] }]);
      } catch (err) {
        setSendFailure(toDeliveryFailure(err));
      } finally {
        setSending(false);
      }
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

  if (handshake.status === 'error') {
    return (
      <main className="agentforge-cui">
        <h1 className="agentforge-cui__title">Clinical Co-Pilot</h1>
        {handshake.message === 'no_chart_bound' || handshake.message === 'no_patient_context' ? (
          <>
            <h2 className="agentforge-cui__subtitle">Open a patient chart to begin.</h2>
            <p className="agentforge-cui__hint">
              AgentForge needs an active chart to read or propose anything.
            </p>
          </>
        ) : (
          <p className="agentforge-cui__hint">
            {handshake.message === 'missing_api_base'
              ? 'Agent API URL is not configured (set AGENTFORGE_API_PUBLIC_URL for PHP).'
              : 'Unable to start session. Refresh the chart page or contact an administrator.'}
          </p>
        )}
      </main>
    );
  }

  if (handshake.status === 'loading' || handshake.status === 'idle') {
    return (
      <main className="agentforge-cui">
        <h1 className="agentforge-cui__title">Clinical Co-Pilot</h1>
        <p className="agentforge-cui__hint">Connecting…</p>
      </main>
    );
  }

  function refreshChartBinding(): void {
    window.location.reload();
  }

  return (
    <main className="agentforge-cui">
      <header className="agentforge-cui__header">
        <h1 className="agentforge-cui__title">Clinical Co-Pilot</h1>
        <button
          type="button"
          className="agentforge-cui__refresh"
          onClick={refreshChartBinding}
          title="Re-handshake with the chart (use after saving a new encounter so the assistant sees it)"
          aria-label="Refresh chart binding"
        >
          Refresh chart
        </button>
      </header>
      {presenting ? <p className="agentforge-cui__hint">Preparing case presentation…</p> : null}
      <MessageList
        messages={messages}
        boundPatientUuid={patientUuid}
        {...(proposalEnv !== undefined ? { proposalEnv } : {})}
        voiceCompletedProposalIds={voiceCompletedProposalIds}
      />
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
