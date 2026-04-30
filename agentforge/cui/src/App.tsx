import type { FormEvent, ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { postChat } from './api/client.js';
import { MessageList, type ChatMessage } from './chat/MessageList.js';
import { useHandshake } from './chat/useHandshake.js';
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

export default function App(): ReactElement {
  const { launchCode, patientUuid } = useMemo(() => readDocumentHints(), []);
  const handshake = useHandshake(launchCode, patientUuid);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const apiBase = useMemo(() => readApiBase(), []);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (text === '' || handshake.status !== 'ready') {
      return;
    }

    setSending(true);
    setSendError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', blocks: [{ type: 'text', text }] }]);

    try {
      const { blocks } = await postChat(apiBase, handshake.sessionToken, patientUuid ?? '', text);
      setMessages((prev) => [...prev, { role: 'assistant', blocks }]);
    } catch (err) {
      const code = err instanceof Error ? err.message : 'chat_failed';
      setSendError(code);
    } finally {
      setSending(false);
    }
  }

  if (handshake.status === 'error') {
    return (
      <main className="agentforge-cui">
        <h1 className="agentforge-cui__title">Clinical Co-Pilot</h1>
        <p className="agentforge-cui__hint">
          {handshake.message === 'no_patient_context'
            ? 'Open a patient chart to use the co-pilot.'
            : handshake.message === 'missing_api_base'
              ? 'Agent API URL is not configured (set AGENTFORGE_API_PUBLIC_URL for PHP).'
              : 'Unable to start session. Refresh the chart page or contact an administrator.'}
        </p>
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

  return (
    <main className="agentforge-cui">
      <h1 className="agentforge-cui__title">Clinical Co-Pilot</h1>
      <MessageList messages={messages} />
      {sendError !== null ? (
        <p className="agentforge-cui__error" role="alert">
          {sendError === 'api_misconfigured_llm'
            ? 'The assistant is not configured on the server (LLM provider).'
            : 'Message could not be sent. Try again.'}
        </p>
      ) : null}
      <form className="agentforge-cui__form" onSubmit={(ev) => void onSubmit(ev)}>
        <label htmlFor="agentforge-message" className="visually-hidden">
          Message
        </label>
        <textarea
          id="agentforge-message"
          className="agentforge-cui__input"
          rows={3}
          value={input}
          disabled={sending}
          placeholder="Ask about this patient (read-only in V1)…"
          onChange={(ev) => setInput(ev.target.value)}
        />
        <button type="submit" className="agentforge-cui__send" disabled={sending || input.trim() === ''}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </main>
  );
}
