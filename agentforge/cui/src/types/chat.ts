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
};

export type ChatResponse = {
  ok: true;
  blocks: ChatBlock[];
  correlation_id: string;
  citation_navigation?: Record<string, CitationNavigationHint>;
  conversation_id?: string;
};
