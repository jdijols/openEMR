Turn store (Gate 4+) — assistant/user turns and pending proposal lifecycle.

UC-C recap was cut for V1 (see
`Documentation/AgentForge/process/journal/week-1/0501-T1500-brief-consistency-cache.md`):
the underlying `transcripts` / `transcript_segments` tables stay (they
back STT/dictation), but no `/conversations/:id/recap` endpoint or
`buildRecapPayload` helper exists today. The store helpers
(`fetchConversationByExternalId`, `listAssistantTurnBodies`,
`listPendingProposalsForConversation`) are kept as primitives in case a
future feature wants them.
