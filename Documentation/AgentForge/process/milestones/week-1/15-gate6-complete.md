# Stage 15 — Gate 6 complete (engineering)

**Purpose:** Record closure of **Gate 6 — Eval + Observability + Deploy**
from [`TASKS.md`](../../../../../TASKS.md):
two-vhost Caddyfile, preflight credential gate, PHI redactor (S7),
LLM provider swap (Anthropic + Azure OpenAI), Synthea fixtures + 13
curated/adversarial cases, §8 security baseline script, demo storyboard,
CUI cache-busting, Langfuse self-hosted compose service, auto-register
module on fresh OpenEMR DBs, and the Context Service HTTP-matrix
backfill (G6-20, structural).

This stage skips a dedicated "Gate 5 complete" file because Gate 5 was
already marked CLOSED in the task list with **G5-08** carried as the
operator-side manual smoke (`[~]`). Gate 6's exit criteria did not
gate on that manual smoke.

## Verification

**Gate 6** — Task list **CLOSED (engineering)** (2026-05-01) for
G6-01..G6-18 + G6-20. Session journal:
[`journal/week-1/0501-T1558-gate6-closed-eval-llm-repair.md`](../../journal/week-1/0501-T1558-gate6-closed-eval-llm-repair.md).
Final regression sweep:

- API Vitest: **140 passed / 1 skipped** (`agentforge/api && npm test`).
- AgentForge isolated PHPUnit: **67 tests / 414 assertions**
  (`composer phpunit-isolated -- tests/Tests/Isolated/Modules/AgentForge`).
- Eval runner: **13 cases / 0 failures** across 6 check types
  (`npm run eval`).

## Decisions (lifted from session journal)

- **G6-15 — env-only LLM provider swap.** `LLM_PROVIDER` enum (`anthropic`
  | `openai_azure`); 4 optional `OPENAI_AZURE_*` keys; cross-field
  validation in `agent/model.ts` produces typed
  `OpenAiAzureMissingDeploymentIdError` /
  `OpenAiAzureMissingEndpointError` /
  `UnsupportedLlmProviderError`. `app.ts` maps any of them to the
  documented `501 misconfigured` for both `/present-patient` and
  `/chat` (PRD §5.7.2). `@ai-sdk/azure ^3.0.59` added.
- **G6-08 — PHI redactor (S7).** `JOHN DOE 1980-01-01` +
  `(555) 123-4567` + `first_name=Jane` all replaced with `[REDACTED]`
  across nested trace bodies. Test-first.
- **G6-10..G6-12 — Eval runner refactor.** Dispatches by
  `check` name across 6 deterministic rules
  (`no_write_without_confirm`, `unsupported_write_target_rejected`,
  `cross_patient_blocked`, `internal_disclosure_blocked`,
  `vitals_parser_uncertain_not_guess`,
  `negative_claim_requires_empty_query`). 17 unit tests in
  `runner-rule.test.ts` cover every rule directly; 13 curated /
  adversarial cases drive the live `npm run eval` report.
- **G6-01 — Two-vhost Caddyfile.** `AGENTFORGE_OE_PUBLIC_HOSTNAME` +
  `AGENTFORGE_API_PUBLIC_HOSTNAME`; shared `(security_headers)`
  snippet (HSTS + nosniff + Referrer-Policy); CSP `frame-ancestors`
  on the API vhost only; `/stt/*` WebSocket upgrade match block.
  Migration path documented in `docker/agentforge/README.md`.
- **G6-05 — `preflight.sh` + test harness.** 6 scenarios (happy,
  missing LLM key, default admin password, pristine sqlconf,
  placeholder secret, missing env file) all green.
- **G6-13 — `security_baseline.sh`.** Covers §8.1 active-chart
  binding, §8.2 no tokens in URLs, §8.3 no privilege bypass, §8.4
  CORS allowlist, §8.5 generic-500-with-correlation-id, §8.7 redactor
  proxy, §8.9 audit row proxy.
- **G6-18 — Auto-register module.** `Install/ModulesRegistryStore`
  interface + `QueryUtilsModulesRegistryStore` adapter +
  `Install/AgentForgeModuleRegistrar` (typed `RegisterOutcome`);
  CLI entrypoint `bin/agentforge-enable.php`. Idempotent across
  Inserted / Unchanged / OperatorDisabled outcomes.
- **G6-16 — CUI cache-busting.** `panel.php` appends `md5_file()`
  hash query strings to `agentforge-cui.js` and
  `agentforge-cui-index.css`.
- **G6-07 — Langfuse self-hosted compose service.**
  `docker-compose.override.yml` Langfuse v2 service finalized:
  `env_file`, `?schema=langfuse` for DB isolation, healthcheck,
  required `LANGFUSE_NEXTAUTH_*` + `LANGFUSE_SALT` documented;
  runbook in `docker/agentforge/langfuse/README.md`.
- **G6-20 — Context Service HTTP-matrix backfill (structural).**
  Per-endpoint structural contracts (binding ingress, audit log,
  JSON envelope, no `SELECT *`, all nine §4.4 endpoints present)
  enforced in `ContextEndpointsStaticStructureTest.php`. Full
  DB-bootstrapped harness deferred per tier-6 cuttability; deferral
  rationale lives in the test file's docblock.
- **Pre-existing tech debt surfaced (not regressions).**
  4 pre-Gate-6 typecheck errors in test files (`RequestInfo` import
  + an inferred-`never` in a skipped pg test) deferred to a Gate 7
  polish pass. **G5-06 source/test drift** —
  `agentforge/api/src/conversations/recap.ts` is deleted in the
  working tree but never committed, alongside two stale
  `recap.test.ts` files; flagged in the Gate 6 status block as an
  operator decision (commit the removal + reconcile G5-06 done-proof,
  or restore from `HEAD`).

## Next

**Gate 7** — Submission Bundle. See
[`TASKS.md` § Gate 7](../../../../../TASKS.md#gate-7--submission-bundle):
Loom recording (UC-A + UC-B propose→confirm→write + UC-C + refusal),
social post, `submission.md` URL bundle, final §13.4 checklist,
`ai-cost-analysis.md` cost appendix (G7-07), and the 11:45 cellular
smoke before the 12:00 submission. Manual operator-side rehearsals
inherited from Gate 6 — Azure live smoke (G6-15), cellular
reachability (G6-02), fresh-VPS bootstrap (G6-06) — should land in
the same window.

**Prior milestone:** [Stage 14 — Gate 4 complete](14-gate4-complete.md).
