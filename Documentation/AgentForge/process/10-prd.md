# Stage 10 — PRD & execution map

This milestone closes the loop from Stage 5 architecture into an engineer-facing implementation spec and a **gate-ordered task list** for build execution.

## Canonical artifacts

| Artifact | Purpose |
| -------- | ------- |
| [`PRD.md`](../../../PRD.md) | Full V1 Clinical Co-Pilot implementation spec (AUDIT/USERS/ARCHITECTURE operationalized). |
| [`implementation/clinical-copilot-task-list.md`](../implementation/clinical-copilot-task-list.md) | Dependency-first gates (0–7), stop-the-line tests, PRD tracebacks, cut-tier mapping from §15.1. |

Prior journal that wrote the PRD: [`journal/week-1/0429-T2200-prd-implementation-complete.md`](journal/week-1/0429-T2200-prd-implementation-complete.md).

Session that added this milestone + task list + Gate 0 handoff: [`journal/week-1/0429-T2100-task-list-process-10.md`](journal/week-1/0429-T2100-task-list-process-10.md).

## Decisions (durable)

- **Execution order:** Gates are dependency-first (security primitives → vertical read slice → UC-A completeness → writes → STT/UC-C → deploy/eval/Langfuse → submission), not PRD section order. One parallel lane after Gate 2: deploy skeleton while completing reads.
- **Langfuse:** Env contract + observability interface + no-op fallback in Gate 0; self-hosted UI, telemetry wiring, redaction tests in Gate 6.
- **Testing posture:** Test-first for security and agent correctness; smoke/manual for scaffold and low-risk UI.
- **Cut tiers:** Mechanical mapping from [`PRD.md` §15.1](../../../PRD.md#151-cuttable-scope-tiers-apply-in-order-if-you-must-cut) to task IDs in the implementation task list.

## Next execution step

Begin **Gate 1** — security primitives — from [`implementation/clinical-copilot-task-list.md`](../implementation/clinical-copilot-task-list.md#gate-1--security-primitives-first).

## Decisions (update 2026-04-30)

- **Gate 0 closed:** Scaffold + contract spine verified on engineer host and pushed to GitLab. Milestone: [`process/11-gate0-complete.md`](11-gate0-complete.md); journal: [`journal/week-1/0429-T2015-gate0-verified-gitlab.md`](journal/week-1/0429-T2015-gate0-verified-gitlab.md). Task list rows marked `[x]` in [`implementation/clinical-copilot-task-list.md`](../implementation/clinical-copilot-task-list.md).
