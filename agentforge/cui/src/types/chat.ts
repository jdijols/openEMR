export type CitationNavigationHint = {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
};

export type ClaimSegment =
  | { type: 'text'; text: string }
  | { type: 'cite'; text: string; citation_id: string };

/**
 * Terminal resolution state for a proposal card. Lifted out of the
 * `ProposalBlock` component's local `useState` so it can ride along on
 * the cached `ChatBlock` and survive a hard reload (Refresh chart, panel
 * remount). Only terminal phases are persisted — `idle` and `submitting`
 * are transient UI affordances that should reset to `idle` on remount
 * (server-side idempotency in `confirmPendingProposal` handles a
 * reload-then-reclick).
 */
export type ProposalResolution =
  | { readonly phase: 'accepted' }
  | { readonly phase: 'declined' }
  | { readonly phase: 'openemr_denied'; readonly openemrReason?: string }
  | { readonly phase: 'delivery_failed'; readonly deliveryMessage?: string };

/** §9 / G2-MVP-99 — surfaced by orchestrator on successful `attach_and_extract`. */
export type IntakeProposalData = {
  readonly demographics: { name: string | null; dob: string | null; sex: string | null; contact_phone: string | null };
  readonly chief_concern: { text: string; onset: string | null };
  readonly current_medications: ReadonlyArray<{ name: string; dose: string | null; frequency: string | null }>;
  readonly allergies: ReadonlyArray<{ substance: string; reaction: string | null; severity: string | null }>;
  readonly family_history: ReadonlyArray<{ relation: string; condition: string }>;
};

export type ChatBlock =
  | { type: 'text'; text: string }
  | {
      type: 'claim';
      text?: string;
      citation_ids?: string[];
      segments?: readonly ClaimSegment[];
    }
  | { type: 'warning'; text: string }
  | { type: 'refusal'; reason: string }
  | { type: 'tool_call'; name: string; detail?: string }
  | { type: 'tool_result'; tool: string; detail?: string }
  | {
      type: 'proposal';
      proposal_id: string;
      write_target: string;
      preview: string;
      resolved?: ProposalResolution;
    }
  | {
      type: 'extraction';
      doc_type: 'lab_pdf' | 'intake_form';
      docref_uuid: string;
      n_facts: number;
      n_abnormal?: number;
      /** G2-Early-27 informational preview (no chart write yet). */
      lab_summary?: string;
      intake_data?: IntakeProposalData;
      /** Upload-provided OpenEMR ids forwarded by the server on this turn's
       *  extraction block. When both are present, the "View in documents"
       *  link issues a NAV_REQUEST directly without doing a client-side
       *  messages.find lookup. When absent, the link is hidden. */
      oe_document_id?: number;
      oe_patient_pid?: number;
    }
  | {
      /**
       * G2-Final-FB-A-03 — supervisor handoff strip. Synthesized server-side
       * by `synthesizeAgentSteps` so the CUI can render an inline one-line
       * summary (worker · duration · key stat) with click-to-expand detail
       * (reason, input_summary, full stats). Strictly additive; existing
       * blocks are unchanged.
       */
      type: 'agent_step';
      worker: 'intake_extractor' | 'evidence_retriever';
      reason: string;
      input_summary: Readonly<Record<string, unknown>>;
      duration_ms: number;
      outcome: 'ok' | 'no_results' | 'error';
      stats?: Readonly<Record<string, unknown>>;
    };

export type RedeemResponse = {
  session_token: string;
  identity: {
    user_id: number;
    patient_uuid_present: boolean;
    encounter_id_present: boolean;
  };
  expires_at: string;
};

/**
 * G2-MVP-99 — when the user sends a message with a file attachment, the
 * file rides along on the ChatMessage so the bubble can render the same
 * preview chip used in the composer (minus the X). Once the upload
 * completes, `docrefUuid` is filled in so clicking the chip opens
 * DocumentModal at page 1.
 */
export type ChatAttachment = {
  /** Original File for inline rendering (PDF first-page thumbnail / image src). */
  file: File;
  mimeType: string;
  name: string;
  /** Filled in once the upload completes; clickable preview opens DocumentModal. */
  docrefUuid?: string;
  /**
   * Filled in alongside `docrefUuid` when the parallel OpenEMR-`documents`
   * registrar projection succeeded. Used by the post-extraction "View in
   * documents" link to open the canonical OpenEMR Document viewer
   * (`/controller.php?document&view&...`) rather than the in-rail bbox modal.
   */
  oeDocumentId?: number;
  /** Numeric pid for the bound patient — needed to build the Documents-tab URL. */
  oePatientPid?: number;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  blocks: ChatBlock[];
  /** Per-turn index from Agent API (PRD §6.7); assistant messages only. */
  citation_navigation?: Record<string, CitationNavigationHint>;
  /**
   * Origin of a user turn. Purely a UI affordance — the Agent API receives
   * clean text regardless of source, so parsing (vitals, allergies, …) is
   * identical for typed and dictated input.
   */
  source?: 'typed' | 'dictation';
  /** G2-MVP-99 — present when the user sent a file alongside the message. */
  attachment?: ChatAttachment;
};

export type ChatResponse = {
  ok: true;
  blocks: ChatBlock[];
  correlation_id: string;
  citation_navigation?: Record<string, CitationNavigationHint>;
  conversation_id?: string;
};
