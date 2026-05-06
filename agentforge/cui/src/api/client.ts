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

export async function postChat(
  apiBase: string,
  sessionToken: string,
  patientUuid: string,
  message: string,
  opts?: Readonly<{
    conversation_id?: string;
    docref_uuid?: string;
    doc_type?: 'lab_pdf' | 'intake_form';
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
): Promise<{ docrefUuid: string; mimeType: string; fileSize: number; reUpload: boolean }> {
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
    mime_type?: string;
    file_size?: number;
    re_upload?: boolean;
  };
  return {
    docrefUuid: body.docref_uuid,
    mimeType: typeof body.mime_type === 'string' ? body.mime_type : file.type,
    fileSize: typeof body.file_size === 'number' ? body.file_size : file.size,
    reUpload: body.re_upload === true,
  };
}
