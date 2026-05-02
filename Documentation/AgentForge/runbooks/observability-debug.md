# Runbook — Debugging from a `correlation_id`

When a clinician reports a weird agent response — a refusal that should have been an answer, a stuck tool, an unexpectedly high cost — the entry point for any investigation is the `correlation_id` for that turn. This runbook is the step-by-step for getting from "user reported a problem" to "I know what happened" using Langfuse Cloud and the application's logs.

It also documents the canonical Langfuse views that should be saved against the AgentForge project — the queries an on-call engineer or instructor reviewer should be able to pull up in two clicks.

---

## 1. Get the correlation_id

The correlation_id is the trace id in Langfuse and the primary cross-reference between the application logs, the conversation database, and the Langfuse trace surface. Three places to find it:

- **HTTP response header.** Every API response carries `X-Correlation-Id`. If the clinician shared a screenshot of dev-tools, the header is the fastest path.
- **Conversation log.** The `conversations` table in Postgres stores `correlation_id` per turn. If the user can give you the conversation id and an approximate time, query:
  ```sql
  SELECT correlation_id, role, ts
  FROM turns
  WHERE conversation_id = '<conversation-uuid>'
  ORDER BY ts DESC
  LIMIT 20;
  ```
- **Application stdout.** The agent API logs structured JSON for every turn including `correlation_id`. Tail the container's stdout if neither of the above is available:
  ```bash
  docker compose logs agentforge-api --tail 500 | grep correlation_id
  ```

If the clinician can't give you a precise timestamp and there are many recent turns, the conversation log is usually the most reliable starting point.

---

## 2. Load the Langfuse trace

With a correlation_id in hand, open the Langfuse Cloud UI at [https://us.cloud.langfuse.com](https://us.cloud.langfuse.com) → AgentForge project → **Tracing**. Paste the correlation_id into the search field. The trace appears as a single row keyed by id.

Open the trace. The timeline shows the chat turn end-to-end:

```
Trace: turn (correlation_id = 8a7c…)
├── span: get_identity                  [12ms, success]
├── span: get_problems                  [18ms, success]
├── span: get_medications               [22ms, success]
├── span: get_allergies                 [11ms, success]
├── event: verification.uncited_claim_removed
├── event: verification.med_status_conflict_warning
└── generation: response_completed      [model=claude-haiku-4-5, tokens, cost]
```

Each row is clickable. Span detail shows the redacted input meta, output meta, and (on failure) the truncated error message. Generation detail shows the model name, input/output token counts, dollar cost, and (when threaded through) the LLM's response duration.

The PHI redactor scrubs every meta payload before it reaches Langfuse — see [`OBSERVABILITY.md` §"PHI redactor"](../../../OBSERVABILITY.md). If you need to inspect raw inputs, you cannot do it from the trace; you must reproduce the turn locally with logging enabled.

---

## 3. Common debugging patterns

### Pattern A — "Why did this turn return a refusal?"

The verification layer emits a categorized event for every gate that fires. Look for `event: verification.*` rows in the trace timeline:

| Event | Meaning |
|-------|---------|
| `verification.cross_patient_block` | Tool was called against a UUID that doesn't match the bound chart. Check the active-chart binding for that session. |
| `verification.uncited_claim_removed` | At least one claim block had no citation in the tool-evidence set. The model hallucinated a citation or wrote a claim with none. |
| `verification.uncited_claim_removed_summary` | Multiple uncited claims stripped this turn. |
| `verification.negative_claim_removed` | A "no allergies / no labs" statement was made without an empty-query observation backing it. Either the tool wasn't called or the call returned non-empty. |
| `verification.med_status_conflict_warning` | Claim asserted chronic-use language for a medication whose row is marked inactive/discontinued. (This is a warning, not a strip — the claim still ships.) |

If the trace ends with a `refusal` block in the response and one of the events above appears, the refusal is *intentional* — the verification layer caught a problem. The fix is upstream (correct the tool call, fix the bound chart, etc.), not in the verification layer.

If the response is a refusal but no verification event appears, the refusal came from the model itself (e.g., it explicitly answered with `{"type": "refusal"}` because the system prompt told it to). Read the system prompt and the user message in the trace's generation row.

### Pattern B — "Why did this tool fail?"

Failed tool spans are visually marked in Langfuse (red border, `level: ERROR`). Click the failed span. The detail panel shows:

- `statusMessage` — truncated `String(e)` from the thrown error.
- `output.error` — the original error object (after PHI redaction).
- `input.meta` — what we passed to the tool (after PHI redaction).

If `statusMessage` is `unreachable` or `secret_mismatch`, the OpenEMR module's `/health/internal_auth.php` probe is the next stop — check the API container's reachability and the shared secret env var.

If the failure is a structured outcome (rejected proposal, unsupported write target) it appears in the span's *output meta* without the ERROR-level marking. Look for `rejection_reason` and `write_target` in the output panel.

### Pattern C — "Why is this turn so expensive?"

Open the `generation: response_completed` row. Costs are computed by Langfuse from the canonical model name and the token counts — see [`OBSERVABILITY.md` §Q4](../../../OBSERVABILITY.md). Look at:

- **Input tokens.** Large input tokens usually means a big chart-context payload from the Context Service. Spot-check the tool spans for unusually large `output.row_count`.
- **Output tokens.** Large output tokens usually means the model produced a long response. Compare against UC-A briefing length norms.
- **Model.** If the model name is not the Haiku 4.5 default, the operator may have switched providers or models. The in-process [`cost_estimate.ts`](../../../agentforge/api/src/agent/cost_estimate.ts) is a heuristic per provider key; the Langfuse-side cost is authoritative.

The `/health` endpoint reports `langfuse: "not_configured"` if keys are placeholder, `"unreachable"` if the egress is blocked, `"ok"` if the API surface responds. A `not_configured` status means traces are NOT being captured — every recent turn is invisible to Langfuse. This is a deploy-time fix, not a runtime fix.

---

## 4. Canonical Langfuse views

These are the curated views that should be saved against the AgentForge project so on-call and instructor reviewers can answer common questions in two clicks. Save each view in Langfuse Cloud → AgentForge → Tracing → "Save as view".

### View 1 — P95 tool latency by tool name

**Question answered:** Is any tool slow, and which one?

- **Filter:** `name` contains `get_` or `propose_` (any tool span).
- **Group by:** `name`.
- **Aggregate:** P95 of `duration_ms`.
- **Time window:** Last 24 hours.

Useful for catching slow chart reads (Context Service degradation) before clinicians complain.

### View 2 — Refusal rate by category

**Question answered:** What's the refusal mix this week, and is any category trending up?

- **Filter:** `name` starts with `verification.`.
- **Group by:** `name` (i.e., the verification category).
- **Aggregate:** Count.
- **Time window:** Last 7 days.

Useful for catching prompt-injection waves, broken active-chart bindings, or model regressions that cause uncited-claim spikes.

### View 3 — Cost per turn, broken down by use case

**Question answered:** Is one use case (UC-A pre-room briefing vs UC-B in-room dictation) blowing the cost budget?

- **Filter:** Trace name = `turn` (excludes auto-brief and other surfaces).
- **Group by:** Trace metadata `use_case` if tagged; otherwise compute median across the population.
- **Aggregate:** Median and P95 `total_cost`.
- **Time window:** Last 24 hours.

Pair with the [`ai-cost-analysis.md`](../implementation/ai-cost-analysis.md) per-turn budget projections to see if the live system is on track.

### View 4 — Tool failure rate

**Question answered:** Is any tool unhealthy?

- **Filter:** `level` = `ERROR`.
- **Group by:** `name`.
- **Aggregate:** Count.
- **Time window:** Last 24 hours.

A baseline above zero on any tool is a flag worth investigating. The tool's `statusMessage` field reveals the cause class (network, secret mismatch, unexpected payload, etc.).

---

## 5. When the trace has no answer

The PHI redactor is conservative — it over-redacts to keep traces safe. There are a small number of debugging questions the trace alone cannot answer:

- *"What did the patient name look like that the model saw?"* — redacted at multiple layers; not visible.
- *"What was the verbatim system prompt content for that turn?"* — not in traces; check `agentforge/api/src/agent/system_prompt.ts` at the commit deployed at the time.
- *"What was the chain-of-thought between tool calls?"* — not exposed by the SDK; we don't capture it.

For these, the next step is to reproduce the turn locally with the same chart context, against a debug build that disables PHI redaction temporarily. **Never disable redaction in production.** See [`OBSERVABILITY.md` §"What we don't observe"](../../../OBSERVABILITY.md) for the full list of intentional gaps.

---

## 6. Cross-references

- [`OBSERVABILITY.md`](../../../OBSERVABILITY.md) — full architectural narrative, the four "brief questions" answered, the PHI redactor's deliberate over-redaction trade-off.
- [`agentforge/api/src/observability/index.ts`](../../../agentforge/api/src/observability/index.ts) — observability layer source. Module-level docblock at the top of file names the trace shape.
- [`agentforge/api/src/observability/redact.ts`](../../../agentforge/api/src/observability/redact.ts) — PHI deny-list. The redactor coverage matrix at [`agentforge/api/test/observability/redact.coverage.test.ts`](../../../agentforge/api/test/observability/redact.coverage.test.ts) documents what's redacted, what survives, and what's deliberately over-redacted.
- [`/health` endpoint](../../../agentforge/api/src/app.ts) — `probeLangfuse` returns `ok` / `unreachable` / `not_configured`. Use it as the first check when traces are missing.
- [`ai-cost-analysis.md`](../implementation/ai-cost-analysis.md) — per-turn cost projections across MAU tiers. Pair with the cost-per-turn Langfuse view above.
