import { useEffect, useState } from 'react';
import { redeemHandshake } from '../api/client.js';
import { readApiBase } from '../config.js';

export type HandshakeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sessionToken: string }
  | { status: 'error'; message: string };

export function useHandshake(launchCode: string | null, patientUuid: string | null): HandshakeState {
  const [state, setState] = useState<HandshakeState>({ status: 'idle' });

  useEffect(() => {
    const apiBase = readApiBase();
    if (apiBase === '') {
      setState({ status: 'error', message: 'missing_api_base' });
      return;
    }

    if (!launchCode || launchCode === '') {
      setState({ status: 'error', message: 'missing_launch_code' });
      return;
    }

    if (!patientUuid || patientUuid === '') {
      setState({ status: 'error', message: 'no_patient_context' });
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const result = await redeemHandshake(apiBase, launchCode);
        if (cancelled) {
          return;
        }
        setState({ status: 'ready', sessionToken: result.session_token });
      } catch {
        if (cancelled) {
          return;
        }
        setState({ status: 'error', message: 'handshake_failed' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [launchCode, patientUuid]);

  return state;
}
