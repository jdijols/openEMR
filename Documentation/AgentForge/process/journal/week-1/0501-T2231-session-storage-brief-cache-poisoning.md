---
date: 2026-05-01
topic: Clinical Copilot auto-brief stuck on “could not be displayed” — Session Storage payload cache poisoning
related_milestone: [process/milestones/week-1/13-gate3-complete.md](../../milestones/week-1/13-gate3-complete.md)
---

# Session Storage poisoned brief payloads — session journal

## Goal

Explain why some patients (initially Marcus Hill, then Harold Jensen) showed only *“The assistant returned a response that could not be displayed…”* in the Clinical Copilot rail despite other charts working, and record the operator-side fix that restored those charts.

## Context

Auto case presentation (`POST /present-patient`) returns structured `blocks`. When the model output looks like a `{"blocks":[...]}` envelope but no block passes Zod validation, the API substitutes a single `text` block with that fallback message (see [`agentforge/api/src/agent/orchestrator.ts`](../../../../../agentforge/api/src/agent/orchestrator.ts) — `parseBlocksFromModelText`). The CUI then persists successful-looking payloads in **Session Storage** under `agentforge:brief_payload:<patient_uuid>` and `agentforge:conversation_payload:<patient_uuid>` (see [`agentforge/cui/src/chat/brief_cache.ts`](../../../../../agentforge/cui/src/chat/brief_cache.ts), [`agentforge/cui/src/App.tsx`](../../../../../agentforge/cui/src/App.tsx) replay order). A bad brief therefore replays on every reopen for that patient until TTL eviction or manual removal. Related prior work: [`0501-T1500-brief-consistency-cache.md`](./0501-T1500-brief-consistency-cache.md), [`0501-T2105-cui-conversation-cache-refresh-icon-two-hour-ttl.md`](./0501-T2105-cui-conversation-cache-refresh-icon-two-hour-ttl.md).

Browser console showed unrelated noise (`background_service/$run` 500, `patient_picture` 403); those do not explain the Copilot message, which matched the cached payload pattern.

## Key decisions

### Decision: treat Session Storage as the smoking gun, not Marcus-specific data

- **Prompt:** Symptoms were “only Marcus Hill” then “also Harold Jensen,” with DevTools Application → Session Storage showing multiple `agentforge:brief_payload:*` / `agentforge:conversation_payload:*` values containing the fallback text.
- **Recommendation:** Diagnose as **per-tab payload cache replay** of a prior bad `/present-patient` result, not a single broken seed row or ACL.
- **Outcome:** Confirmed multiple UUID keys held the same fallback JSON; cohort roster shows both patients as heavy synthetic charts ([`Documentation/AgentForge/cohort/roster.md`](../../../cohort/roster.md) — Marcus `AF-COHORT-002`, Harold `AF-COHORT-009`).

### Decision: surgical Session Storage cleanup + reload (not “Clear all”)

- **Prompt:** DevTools table context menu offered Reset columns / Refresh / Delete — no obvious “Clear all” for the table; user needed a safe path forward.
- **Recommendation:** Use **Delete** on individual keys, or run a **Console** snippet that removes only `agentforge:brief_payload:*` and `agentforge:conversation_payload:*` entries whose value contains `could not be displayed`, then `location.reload()`.
- **Outcome:** User ran the targeted cleanup; Marcus and Harold (and other poisoned UUIDs) recovered without wiping unrelated site Session Storage.

### Decision: ignore background_service / patient_picture console errors for this incident

- **Prompt:** User pasted many 500/403 lines alongside the Copilot symptom.
- **Recommendation:** Treat OpenEMR background service and missing patient photo fetches as **orthogonal** unless `/present-patient` or `/chat` shows a matching failure.
- **Outcome:** Resolution did not require fixing those endpoints; the rail behavior aligned with cached AgentForge payloads.

## Trade-offs and alternatives

- **Clear all Session Storage for the origin** — faster but wipes unrelated OpenEMR tab state; rejected in favor of targeted keys.
- **Wait for 2-hour TTL** — works without DevTools but leaves a broken brief for up to two hours per [`brief_cache.ts`](../../../../../agentforge/cui/src/chat/brief_cache.ts); rejected when immediate recovery was needed.

## Tools, dependencies, commands

Browser DevTools → **Application** → **Session Storage** → `http://localhost:8300`, plus **Console** (optional targeted script as used in session):

```js
for (const key of Object.keys(sessionStorage)) {
  if (
    (key.startsWith('agentforge:brief_payload:') ||
      key.startsWith('agentforge:conversation_payload:')) &&
    (sessionStorage.getItem(key) || '').includes('could not be displayed')
  ) {
    sessionStorage.removeItem(key);
  }
}
location.reload();
```

## Files touched

- **Created:** `Documentation/AgentForge/process/journal/week-1/0501-T2231-session-storage-brief-cache-poisoning.md`

_No application code changed in this session._

## Outcomes

Operators can recover a “stuck” fallback brief by removing poisoned AgentForge Session Storage entries (or waiting for TTL). Marcus Hill and Harold Jensen were confirmed examples; the fix was verified in the same session.

## Next steps

- [ ] **Product hardening (optional):** Do not treat the parse-fallback `text` block as a cacheable success — skip `writeCachedBrief` / server `casePresentationCacheSet` for that payload, or map parse failure to a refusal so retries are not pinned for 2 hours ([`agentforge/api/src/agent/case_presentation.ts`](../../../../../agentforge/api/src/agent/case_presentation.ts) `isCacheable`, [`parseBlocksFromModelText`](../../../../../agentforge/api/src/agent/orchestrator.ts)).
- [ ] **Operator doc (optional):** One-line troubleshooting in [`interface/modules/custom_modules/oe-module-agentforge/README.md`](../../../../../interface/modules/custom_modules/oe-module-agentforge/README.md) or CUI README pointing at Session Storage key prefixes + the Console snippet.

## Links

- Numbered milestone: [process/milestones/week-1/13-gate3-complete.md](../../milestones/week-1/13-gate3-complete.md)
- Related journals: [0501-T1500-brief-consistency-cache.md](./0501-T1500-brief-consistency-cache.md), [0501-T2105-cui-conversation-cache-refresh-icon-two-hour-ttl.md](./0501-T2105-cui-conversation-cache-refresh-icon-two-hour-ttl.md)
