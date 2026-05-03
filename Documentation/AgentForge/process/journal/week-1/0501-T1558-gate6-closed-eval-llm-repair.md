---
date: 2026-05-01
topic: Gate 6 closed — repaired phantom prior-session work (G6-15 source, eval runner refactor) + delivered G6-20 structural backfill
related_milestone: ../../15-gate6-complete.md
related_task_list: ../../../../../TASKS.md
---

# Gate 6 — Eval + Observability + Deploy — closed (engineering)

## Goal

Confirm Gates 4 + 5 truly closed by inspecting the codebase (not trusting the
task list), then drive Gate 6 to completion sequentially with regression
checkpoints. User directive: *"if no intervention is needed by me, then
please continue until Gate Six is complete"* and *"be surgically critical with
our edits to not break anything that is currently working."*

## Context

Session started against an inherited working tree where a prior session
claimed (in its summary) that G6-15 LLM provider swap was complete and the
eval runner had been refactored for new check types. Reality on disk:
**neither change had persisted** — only the test files had landed, leaving
the system in a broken-tests state. The user's directive made it clear the
right move was full forensic re-implementation rather than blind trust of
the prior summary.

## Key decisions

### Decision: Trust the codebase, not the prior-session summary

- **Prompt:** *"Let's go ahead and confirm that gate 4 and gate 5 are
  complete by reviewing our codebase and not necessarily trusting our
  copilot task list."*
- **Recommendation:** Re-derive Gate state from source + test runs rather
  than from doc claims. When the API suite reported 4 failing G6-15 tests
  on first checkpoint, treat it as a real signal that a prior change never
  landed; re-implement from scratch rather than patching tests to pass.
- **Outcome:** Found three phantom prior-session changes (G6-15 source,
  eval runner refactor, recap.ts source), all caught and either repaired
  or flagged.

### Decision: Re-implement G6-15 LLM provider swap from scratch

- **Prompt:** *(continuation directive — fix tier-6 + S7 invariants
  needed for Gate 6 close.)*
- **Recommendation:** Install `@ai-sdk/azure`, extend `env.ts` schema to
  `LLM_PROVIDER` enum + 4 optional `OPENAI_AZURE_*` keys (cross-field
  validation lives in `model.ts` so missing-config produces typed errors
  usable by `/chat`), refactor `model.ts` as a `switch` over the enum,
  and update `app.ts` catch-blocks to map `openai_azure_missing_*` →
  `501 misconfigured` (PRD §5.7.2). Document the new keys in
  `secrets.env.example`.
- **Outcome:** 5/5 vitest cases for `getChatModel` provider swap pass;
  full API suite green at 127/1-skipped/0-fail after the repair.

### Decision: Refactor eval runner to dispatch by `check` name

- **Prompt:** *(continuation — `npm run eval` was silently exit 1.)*
- **Recommendation:** The 11 new-format curated cases use
  `check` + `context` not `steps`, so the runner threw
  `invalid_case_structure` on every load. Refactor to a `check`-based
  dispatch table with 6 named rules (`no_write_without_confirm`,
  `unsupported_write_target_rejected`, `cross_patient_blocked`,
  `internal_disclosure_blocked`, `vitals_parser_uncertain_not_guess`,
  `negative_claim_requires_empty_query`). Keep
  `noWriteWithoutPriorConfirm` exported with the same signature so the
  existing `runner-rule.test.ts` stays green. Add 17 unit tests covering
  every new rule.
- **Outcome:** `npm run eval` reports **13 cases / 0 failures** across
  all 6 check types; `runner-rule.test.ts` grows from 2 → 17 tests.

### Decision: G6-20 as structural enforcement, not full HTTP harness

- **Prompt:** *(continuation — Gate 6 includes a tier-6 backfill task.)*
- **Recommendation:** PRD spec for G6-20 calls for a "Docker or
  integration harness as for G2-04" to assert per-endpoint 401 / 403 /
  200 / audit / no-`SELECT *`. That harness is real infrastructure
  work and the gate explicitly tags G6-20 as cuttable (Med criticality,
  tier 6). Extend `ContextEndpointsStaticStructureTest.php` to enforce
  the same four contractual properties an HTTP test would check
  (binding ingress, audit log call, JSON envelope shape, no `SELECT *`)
  plus a floor on the §4.4 endpoint set. Document the deferral honestly
  in the file's docblock.
- **Outcome:** PHP suite grows from 64/357 → 67/414 (5 G6-20 tests / 87
  assertions across 9 endpoints).

### Decision: Surface inherited drift, do not silently fix Gate 5

- **Prompt:** *(continuation — discovered `recap.ts` deleted in working
  tree but never committed, alongside two stale `recap.test.ts` files.)*
- **Recommendation:** Out-of-scope for Gate 6 close. Restoring the
  source would break what a prior session intentionally removed;
  deleting the source would silently cancel the G5-06 done-proof.
  Re-delete the stale test files so the working tree is internally
  consistent, leave the source-deletion as inherited, document the
  discrepancy in the Gate 6 status block as an operator decision.
- **Outcome:** Status block in `TASKS.md` calls
  out the drift; G5-06 row content untouched; vitest stays green
  because both source and tests are absent together.

### Decision: Don't bundle pre-existing typecheck debt into Gate 6

- **Prompt:** *(continuation — `npm run typecheck` reports 4 errors.)*
- **Recommendation:** The 4 errors live in test files last touched in
  Gates 3–5 (`RequestInfo` not in DOM lib + an inferred-`never` in a
  skipped pg integration test). Vitest is green — these are
  typecheck-only failures unrelated to anything Gate 6 touched. Logging
  silent fixes into the Gate 6 close would muddy the diff and risk
  unintended side effects.
- **Outcome:** Documented as pre-existing tech debt in the Gate 6
  status block; deferred to a Gate 7 polish pass or a dedicated
  cleanup commit.

## Trade-offs and alternatives

- **Restore `src/conversations/recap.ts` from `HEAD`** — would
  resurrect the recap classifier + tests, but contradicts the prior
  session's intentional removal. Operator decision to make.
- **Spin up a Dockerized OpenEMR + MariaDB harness for G6-20 HTTP
  matrix** — would give true end-to-end coverage but is the explicit
  cuttable scope; tier-6 backfill remains open if appetite returns
  post-Gate-7.
- **Auto-fix the 4 typecheck errors in test files** — small diff, but
  bundles unrelated polish into Gate 6 close. Cleaner as its own commit.

## Tools, dependencies, commands

- `cd agentforge/api && npm install @ai-sdk/azure --save` — added
  `@ai-sdk/azure ^3.0.59` for the Azure OpenAI provider path. **Gotcha:**
  first attempt silently ran in the OpenEMR root because the shell
  `working_directory` parameter was ignored mid-session; reverted the
  root `package.json` + `package-lock.json` and re-ran with explicit
  `cd` in the command itself.
- `cd agentforge/api && npm test --silent` — final regression: 140
  passed / 1 skipped (was 125 before the session's eval-runner unit
  tests landed).
- `cd agentforge/api && npm run eval` — 13 cases / 0 failures across
  6 check types.
- `composer phpunit-isolated -- tests/Tests/Isolated/Modules/AgentForge`
  — final regression: 67 tests / 414 assertions.

## Files touched

- **Created:**
  - `Documentation/AgentForge/process/journal/week-1/0501-T1558-gate6-closed-eval-llm-repair.md`
  - `Documentation/AgentForge/process/15-gate6-complete.md`
- **Modified:**
  - `agentforge/api/package.json` (+ `@ai-sdk/azure ^3.0.59`)
  - `agentforge/api/package-lock.json`
  - `agentforge/api/src/env.ts` — `LLM_PROVIDER` → enum; 4 optional
    `OPENAI_AZURE_*` keys
  - `agentforge/api/src/agent/model.ts` — `switch`-by-provider with
    typed errors (`UnsupportedLlmProviderError`,
    `OpenAiAzureMissingDeploymentIdError`,
    `OpenAiAzureMissingEndpointError`)
  - `agentforge/api/src/app.ts` — `isLlmConfigError` helper +
    misconfigured-mapping for both `/present-patient` and `/chat`
  - `agentforge/api/eval/runner.ts` — full refactor to 6-check
    dispatch table
  - `agentforge/api/test/eval/runner-rule.test.ts` — 2 → 17 tests
  - `tests/Tests/Isolated/Modules/AgentForge/ContextEndpointsStaticStructureTest.php`
    — 2 → 5 tests / 87 assertions (G6-20)
  - `docker/agentforge/secrets.env.example` — Azure OpenAI keys
    documented
  - `TASKS.md`
    — Gate 6 status header + per-row done-proof for G6-01..G6-18 +
    G6-20; verification recap; pre-existing-debt + recap-drift
    callouts
  - `Documentation/AgentForge/README.md` — process trail row for
    `15-gate6-complete.md`
  - `Documentation/AgentForge/process/02-tooling-and-skills.md` —
    changelog bullet for `@ai-sdk/azure` install
- **Deleted (re-deleted to restore inherited working-tree state — not
  introduced by this session):**
  - `agentforge/api/test/conversations/recap.test.ts`
  - `agentforge/api/test/http/recap.test.ts`

## Outcomes

- **Gate 6 engineering CLOSED** — G6-01..G6-18 + G6-20 all green by
  automated tests + runbooks. Manual G6-02 cellular reachability and
  G6-06 fresh-VPS bootstrap inherit from the existing prod deploy.
  G6-15 stack-level Azure live smoke is operator-side once a deployment
  id exists.
- **G6-15 LLM provider swap actually works on disk** — env-only swap
  between `anthropic` and `openai_azure` with typed
  misconfiguration errors translated to `501 misconfigured`.
- **`npm run eval` exits 0 with 13/13 green across 6 check types** —
  no longer silently broken.
- **G6-20 structural backfill in place** — every Context Service
  endpoint structurally guaranteed to bind, audit, and emit the §4.5
  envelope.
- **Inherited recap.ts drift surfaced** in the task list status block
  with a clear operator decision callout.

## Next steps

- [ ] Operator: rehearse G6-15 live smoke against an Azure OpenAI
      deployment (env-only flip).
- [ ] Operator: re-run G6-02 cellular reachability + G6-06 bootstrap
      against the new two-vhost Caddyfile on a clean VPS / nip.io pair.
- [ ] Operator: decide on the `recap.ts` drift — commit the removal +
      reconcile G5-06 done-proof, or restore from `HEAD` and re-run
      the recap tests.
- [ ] Future polish (Gate 7 or standalone): fix the 4 pre-existing
      `npm run typecheck` errors (`RequestInfo` import + skipped pg
      test inference).
- [ ] Future polish (tier 6): real DB-bootstrapped HTTP matrix
      harness for G6-20 if appetite returns post-Gate-7.
- [ ] Operator: commit the working tree (per repo policy, not done in
      this session).

## Links

- Numbered milestone: [process/15-gate6-complete.md](../../15-gate6-complete.md)
- Task list: [implementation/TASKS.md](../../../../../TASKS.md)
- Prior milestone: [process/14-gate4-complete.md](../../14-gate4-complete.md)
- Inherited drift: [post-deploy-bug-log.md](../../../implementation/post-deploy-bug-log.md)
