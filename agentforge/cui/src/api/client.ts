import type { ChatBlock, ChatResponse, CitationNavigationHint, RedeemResponse } from '../types/chat.js';

/** Thrown when /chat or /present-patient fails (transport, HTTP, or malformed JSON). Inspect `kind` + `correlationId` for UX. */
export type AgentForgeDeliveryKind =
  | 'misconfigured_llm'
  | 'network_unreachable'
  | 'bad_request'
  | 'backend_error'
  | 'invalid_success_response';

export class AgentForgeDeliveryError extends Error {
  /**
   * Literal `error` string from the Agent API response body when present
   * (e.g., `duplicate_proposal`, `unauthenticated`, `missing_encounter_id`).
   * Distinct from `kind`, which is a CUI-side category. Surfaced in the rail
   * so post-deploy bugs are self-diagnosing without a server log dive.
   */
  readonly serverError?: string;

  constructor(
    readonly kind: AgentForgeDeliveryKind,
    readonly correlationId?: string,
    serverError?: string,
  ) {
    const suffix = correlationId !== undefined ? ` (${correlationId})` : '';
    super(`${kind}${suffix}`);
    this.name = 'AgentForgeDeliveryError';
    if (serverError !== undefined) {
      this.serverError = serverError;
    }
  }
}

function readFailBody(json: unknown): { serverError?: string; correlationId?: string } {
  if (json === null || typeof json !== 'object') {
    return {};
  }
  const o = json as { error?: unknown; correlation_id?: unknown };
  const out: { serverError?: string; correlationId?: string } = {};

  if (typeof o.error === 'string') {
    const t = o.error.trim();
    if (t !== '') {
      out.serverError = t;
    }
  }
  if (typeof o.correlation_id === 'string') {
    const t = o.correlation_id.trim();
    if (t !== '') {
      out.correlationId = t;
    }
  }

  return out;
}

/** Map non-OK Agent API responses to typed delivery errors with optional correlation ids for support. */
export function deliveryErrorFromAgentResponse(status: number, json: unknown): AgentForgeDeliveryError {
  const { serverError, correlationId } = readFailBody(json);
  if (status === 501) {
    return new AgentForgeDeliveryError('misconfigured_llm', correlationId, serverError);
  }

  const looksClientFault =
    status === 400 || serverError === 'invalid_request' || serverError === 'bad_request';
  const kind = looksClientFault ? 'bad_request' : 'backend_error';

  return new AgentForgeDeliveryError(kind, correlationId, serverError);
}

function stripBase(base: string): string {
  return base.replace(/\/$/, '');
}

function randomCorrelationId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `cui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const redeemInflight = new Map<string, Promise<RedeemResponse>>();

function redeemKey(apiBase: string, launchCode: string): string {
  return `${stripBase(apiBase)}\0${launchCode}`;
}

async function redeemHandshakeRequest(apiBase: string, launchCode: string): Promise<RedeemResponse> {
  const base = stripBase(apiBase);
  const res = await fetch(`${base}/handshake/redeem`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Correlation-Id': randomCorrelationId(),
    },
    body: JSON.stringify({ launch_code: launchCode }),
  });

  if (!res.ok) {
    throw new Error('handshake_failed');
  }

  const json: unknown = await res.json();
  if (
    !json ||
    typeof json !== 'object' ||
    typeof (json as { session_token?: unknown }).session_token !== 'string'
  ) {
    throw new Error('handshake_invalid_response');
  }

  const idRaw = json as RedeemResponse;
  if (
    !idRaw.identity ||
    typeof idRaw.identity !== 'object' ||
    typeof idRaw.identity.patient_uuid_present !== 'boolean'
  ) {
    throw new Error('handshake_invalid_response');
  }

  return idRaw as RedeemResponse;
}

/**
 * Redeem once per (apiBase, launchCode) in flight — React StrictMode mounts twice in dev;
 * launch codes are single-use server-side.
 */
export function redeemHandshake(apiBase: string, launchCode: string): Promise<RedeemResponse> {
  const key = redeemKey(apiBase, launchCode);
  const hit = redeemInflight.get(key);
  if (hit !== undefined) {
    return hit;
  }
  const p = redeemHandshakeRequest(apiBase, launchCode);
  redeemInflight.set(key, p);
  // Cleanup chain swallows rejection so the dedupe map is cleared without
  // surfacing a duplicate "unhandled rejection" — callers still receive the
  // original rejection from `p`.
  p.catch(() => undefined).finally(() => {
    redeemInflight.delete(key);
  });
  return p;
}

/**
 * Parse a Server-Sent Events stream into discrete `{ event, data }`
 * tuples. Implementation handles the shape Hono's `streamSSE` emits:
 *
 *     event: <name>\n
 *     data: <json>\n
 *     \n
 *
 * Events are separated by a double-LF (also tolerates CRLF). Multi-line
 * `data:` blocks are joined with `\n` per the SSE spec — the API never
 * sends multi-line `data:` today, but the fallback keeps us spec-correct.
 */
async function readSSEStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: { readonly event: string; readonly data: string }) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  const flushBlock = (block: string): void => {
    if (block === '') {
      return;
    }
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    onEvent({ event: eventName, data: dataLines.join('\n') });
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (value !== undefined) {
      buf += decoder.decode(value, { stream: true });
      // SSE event boundaries are blank lines. Tolerate \r\n\r\n as well.
      let boundary = buf.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const block = buf.slice(0, boundary);
        const matchLen = buf[boundary] === '\r' ? 4 : 2;
        buf = buf.slice(boundary + matchLen);
        flushBlock(block);
        boundary = buf.search(/\r?\n\r?\n/);
      }
    }
    if (done) {
      // Flush a trailing event with no terminating blank line.
      flushBlock(buf.trim());
      buf = '';
      return;
    }
  }
}

export type ChatRoutingEvent = Readonly<{
  worker: 'intake_extractor' | 'evidence_retriever';
  label: string;
}>;

export async function postChat(
  apiBase: string,
  sessionToken: string,
  patientUuid: string,
  message: string,
  opts?: Readonly<{
    conversation_id?: string;
    docref_uuid?: string;
    doc_type?: 'lab_pdf' | 'intake_form';
    /**
     * Live routing callback. Fired once per worker invocation, the moment
     * the supervisor's tool call begins executing on the server. The CUI
     * uses this to swap the typing indicator's bare ellipsis for a
     * worker-specific affordance ("Reading file" / "Searching evidence")
     * before the backend I/O lands. Optional — when absent, the function
     * still resolves with the same final payload.
     */
    onRouting?: (event: ChatRoutingEvent) => void;
  }>,
): Promise<{
  blocks: ChatBlock[];
  correlationId: string;
  citation_navigation: Record<string, CitationNavigationHint>;
  conversationId: string | null;
}> {
  const base = stripBase(apiBase);
  const correlationId = randomCorrelationId();
  let res: Response;
  try {
    res = await fetch(`${base}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({
        session_token: sessionToken,
        patient_uuid: patientUuid,
        message,
        ...(opts?.conversation_id !== undefined && opts.conversation_id !== '' ?
          { conversation_id: opts.conversation_id }
        : {}),
        ...(opts?.docref_uuid !== undefined && opts.docref_uuid !== '' ?
          { docref_uuid: opts.docref_uuid }
        : {}),
        ...(opts?.doc_type !== undefined ? { doc_type: opts.doc_type } : {}),
      }),
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable');
  }

  // Pre-stream failures still come back as JSON 4xx (parse failure,
  // invalid_request) — the server gates on those before entering streamSSE.
  // Once the SSE body opens the response is committed to 200 + SSE events,
  // so any failure surfaces as an `error` event in the stream below.
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    throw deliveryErrorFromAgentResponse(res.status, json);
  }

  if (res.body === null) {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }

  let finalPayload: ChatResponse | null = null;
  let errorPayload: { error?: string; correlation_id?: string } | null = null;

  try {
    await readSSEStream(res.body, ({ event, data }) => {
      if (event === 'routing') {
        if (opts?.onRouting === undefined) {
          return;
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        if (parsed === null || typeof parsed !== 'object') {
          return;
        }
        const r = parsed as { worker?: unknown; label?: unknown };
        const worker =
          r.worker === 'intake_extractor' || r.worker === 'evidence_retriever' ? r.worker : null;
        const label = typeof r.label === 'string' && r.label !== '' ? r.label : null;
        if (worker !== null && label !== null) {
          opts.onRouting({ worker, label });
        }
        return;
      }
      if (event === 'final') {
        try {
          const parsed = JSON.parse(data) as ChatResponse;
          finalPayload = parsed;
        } catch {
          /* fall through — finalPayload stays null, caller throws below */
        }
        return;
      }
      if (event === 'error') {
        try {
          errorPayload = JSON.parse(data) as { error?: string; correlation_id?: string };
        } catch {
          errorPayload = { error: 'internal_error' };
        }
      }
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable', correlationId);
  }

  if (errorPayload !== null) {
    const e = errorPayload as { error?: string; correlation_id?: string };
    const cid = typeof e.correlation_id === 'string' && e.correlation_id !== '' ? e.correlation_id : correlationId;
    const serverError = typeof e.error === 'string' ? e.error : undefined;
    if (serverError === 'misconfigured') {
      throw new AgentForgeDeliveryError('misconfigured_llm', cid, serverError);
    }
    throw new AgentForgeDeliveryError('backend_error', cid, serverError);
  }

  const body = finalPayload as ChatResponse | null;
  if (
    body === null ||
    typeof body !== 'object' ||
    body.ok !== true ||
    !Array.isArray(body.blocks)
  ) {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }

  const citation_navigation =
    body.citation_navigation !== undefined &&
    typeof body.citation_navigation === 'object' &&
    body.citation_navigation !== null ?
      body.citation_navigation
    : {};
  return {
    blocks: body.blocks,
    correlationId: body.correlation_id ?? correlationId,
    citation_navigation,
    conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : null,
  };
}

export async function postProposalConfirm(
  apiBase: string,
  sessionToken: string,
  patientUuid: string,
  conversationExternalId: string,
  proposalId: string,
): Promise<{ accepted: boolean; reason?: string }> {
  const base = stripBase(apiBase);
  const correlationId = randomCorrelationId();
  const cid = encodeURIComponent(conversationExternalId);
  let res: Response;
  try {
    res = await fetch(`${base}/conversations/${cid}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({
        session_token: sessionToken,
        patient_uuid: patientUuid,
        proposal_id: proposalId,
      }),
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable', correlationId);
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw deliveryErrorFromAgentResponse(res.status, json);
  }

  if (!json || typeof json !== 'object' || (json as { ok?: unknown }).ok !== true) {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }

  const body = json as { accepted?: unknown; reason?: unknown };
  return {
    accepted: body.accepted === true,
    ...(typeof body.reason === 'string' ? { reason: body.reason } : {}),
  };
}

export async function postProposalReject(
  apiBase: string,
  sessionToken: string,
  patientUuid: string,
  conversationExternalId: string,
  proposalId: string,
): Promise<void> {
  const base = stripBase(apiBase);
  const correlationId = randomCorrelationId();
  const cid = encodeURIComponent(conversationExternalId);
  let res: Response;
  try {
    res = await fetch(`${base}/conversations/${cid}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({
        session_token: sessionToken,
        patient_uuid: patientUuid,
        proposal_id: proposalId,
      }),
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable', correlationId);
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw deliveryErrorFromAgentResponse(res.status, json);
  }

  if (!json || typeof json !== 'object' || (json as { ok?: unknown }).ok !== true) {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }
}

export async function postPresentPatient(
  apiBase: string,
  sessionToken: string,
  patientUuid: string,
  forceRefresh = false,
): Promise<{ blocks: ChatBlock[]; correlationId: string; citation_navigation: Record<string, CitationNavigationHint> }> {
  const base = stripBase(apiBase);
  const correlationId = randomCorrelationId();
  let res: Response;
  try {
    res = await fetch(`${base}/present-patient`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify({
        session_token: sessionToken,
        patient_uuid: patientUuid,
        ...(forceRefresh ? { force_refresh: true } : {}),
      }),
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable');
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw deliveryErrorFromAgentResponse(res.status, json);
  }

  if (
    !json ||
    typeof json !== 'object' ||
    (json as { ok?: unknown }).ok !== true ||
    !Array.isArray((json as ChatResponse).blocks)
  ) {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }

  const body = json as ChatResponse;
  const citation_navigation =
    body.citation_navigation !== undefined &&
    typeof body.citation_navigation === 'object' &&
    body.citation_navigation !== null ?
      body.citation_navigation
    : {};
  return { blocks: body.blocks, correlationId: body.correlation_id ?? correlationId, citation_navigation };
}

/**
 * G2-MVP-99 — multipart upload of a clinical document (lab PDF or intake form)
 * to the OpenEMR module's `/upload/document.php`. Returns the canonical
 * `docref_uuid` which the caller passes into `/chat` to trigger
 * `attach_and_extract`.
 */
export async function postUploadDocument(
  moduleBase: string,
  sessionToken: string,
  patientUuid: string,
  docType: 'lab_pdf' | 'intake_form',
  file: File,
): Promise<{
  docrefUuid: string;
  /** OpenEMR `documents.id` when the parallel registrar projection succeeded; null on best-effort failure. */
  oeDocumentId: number | null;
  /** Numeric pid for the bound patient; null when ChartContextGate didn't resolve one. */
  oePatientPid: number | null;
  mimeType: string;
  fileSize: number;
  reUpload: boolean;
}> {
  if (moduleBase === '') {
    throw new AgentForgeDeliveryError('misconfigured_llm', undefined, 'missing_module_base');
  }
  const base = stripBase(moduleBase);
  const correlationId = randomCorrelationId();

  const form = new FormData();
  form.append('file', file);
  form.append('session_token', sessionToken);
  form.append('patient_uuid', patientUuid);
  form.append('doc_type', docType);
  form.append('correlation_id', correlationId);

  let res: Response;
  try {
    res = await fetch(`${base}/upload/document.php`, {
      method: 'POST',
      headers: { 'X-Correlation-Id': correlationId },
      body: form,
      // Include the OpenEMR session cookies — ChartContextGate requires them
      // (browser-flow path; trusted-agent path uses X-Internal-Auth instead).
      credentials: 'same-origin',
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable', correlationId);
  }

  const json: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw deliveryErrorFromAgentResponse(res.status, json);
  }

  if (
    json === null ||
    typeof json !== 'object' ||
    typeof (json as { docref_uuid?: unknown }).docref_uuid !== 'string'
  ) {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }

  const body = json as {
    docref_uuid: string;
    oe_document_id?: number | null;
    oe_patient_pid?: number | null;
    mime_type?: string;
    file_size?: number;
    re_upload?: boolean;
  };
  return {
    docrefUuid: body.docref_uuid,
    oeDocumentId:
      typeof body.oe_document_id === 'number' && Number.isFinite(body.oe_document_id) && body.oe_document_id > 0
        ? body.oe_document_id
        : null,
    oePatientPid:
      typeof body.oe_patient_pid === 'number' && Number.isFinite(body.oe_patient_pid) && body.oe_patient_pid > 0
        ? body.oe_patient_pid
        : null,
    mimeType: typeof body.mime_type === 'string' ? body.mime_type : file.type,
    fileSize: typeof body.file_size === 'number' ? body.file_size : file.size,
    reUpload: body.re_upload === true,
  };
}

/**
 * G2-Early-26 — direct dispatch from the IntakeProposalCard to the OpenEMR module's
 * write endpoint for one section row. The proposal_id is minted client-side; the module
 * endpoint records it in the completion ledger to dedupe re-applies. Returns
 * `{accepted, reason?}` so the card can render per-row status.
 *
 * `relativeScriptPath` is one of e.g. `write/medication_add.php`,
 * `write/family_history_add.php`, `write/allergy.php`, `write/chief_complaint.php` —
 * canonical paths registered in `agentforge/contracts/module-http-paths.json`.
 */
export async function postModuleWrite(
  moduleBase: string,
  relativeScriptPath: string,
  body: {
    sessionToken: string;
    patientUuid: string;
    proposalId: string;
    encounterId?: number;
    payload: Record<string, unknown>;
  },
): Promise<{ accepted: boolean; reason?: string }> {
  if (moduleBase === '') {
    throw new AgentForgeDeliveryError('misconfigured_llm', undefined, 'missing_module_base');
  }
  const base = stripBase(moduleBase);
  const correlationId = randomCorrelationId();

  const reqBody: Record<string, unknown> = {
    session_token: body.sessionToken,
    patient_uuid: body.patientUuid,
    proposal_id: body.proposalId,
    payload: body.payload,
  };
  if (body.encounterId !== undefined) {
    reqBody['encounter_id'] = body.encounterId;
  }

  let res: Response;
  try {
    res = await fetch(`${base}/${relativeScriptPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-Id': correlationId,
      },
      body: JSON.stringify(reqBody),
      credentials: 'same-origin',
    });
  } catch {
    throw new AgentForgeDeliveryError('network_unreachable', correlationId);
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw deliveryErrorFromAgentResponse(res.status, json);
  }
  if (json === null || typeof json !== 'object') {
    throw new AgentForgeDeliveryError('invalid_success_response', correlationId);
  }

  const result = json as { accepted?: unknown; reason?: unknown };
  const accepted = result.accepted === true;
  const out: { accepted: boolean; reason?: string } = { accepted };
  if (typeof result.reason === 'string' && result.reason !== '') {
    out.reason = result.reason;
  }
  return out;
}
