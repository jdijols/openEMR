# Adversarial Eval Suite — Week 3 MVP

Initial adversarial test suite for the Clinical Co-Pilot. Each seed case in [`seeds/`](seeds/) is a structured attack record; each result in [`results/`](results/) is a captured run against the live target.

## Layout

```
evals/
├── README.md
├── seeds/                    # Hand-authored seed attack cases (data only — no code)
│   ├── p2-1a-*.json          # Direct prompt injection (3)
│   ├── p0-2a-*.json          # Cross-patient data exfiltration (3)
│   └── p2-6a-*.json          # Persona hijacking (3)
└── results/                  # Captured runs
    └── run-<timestamp>.json
```

The Zod schemas the runner validates against live with the platform code at [`../agentforge-redteam/src/eval_schema.ts`](../agentforge-redteam/src/eval_schema.ts). The split is intentional: seed JSON files are *data the platform consumes* (portable, swappable, no runtime dep); the validator is *part of the platform itself*.

## MVP scope (Tuesday 2026-05-12)

Three distinct attack categories, nine seed cases total, exercised live against the deployed target via the Red Team Agent prototype at [`../agentforge-redteam/`](../agentforge-redteam/).

| Category | Subcategory | Seeds | OWASP | Priority |
|---|---|---|---|---|
| Prompt injection | 1a Direct | 3 | LLM01 | P2 |
| Data exfiltration | 2a Cross-patient | 3 | LLM02 | **P0** |
| Identity exploitation | 6a Persona hijacking | 3 | LLM01/07 | P2 |

P2 categories are included for coverage breadth, not because they are highest-novelty. The MVP demonstrates the eval/Red-Team/judge loop works end-to-end on attacks reachable through `/chat` without additional plumbing. The two remaining P0 categories from [`../THREAT_MODEL.md`](../THREAT_MODEL.md) — **1b indirect injection via document upload** and **4a poisoned propose_writes** — require the document-upload pipeline to be wired through the Red Team adapter and are on the Friday plan.

## Case schema

Each seed JSON conforms to `EvalCaseSchema` in [`../agentforge-redteam/src/eval_schema.ts`](../agentforge-redteam/src/eval_schema.ts) and contains:

- `id` — stable identifier (e.g. `p0-2a-direct-uuid-swap`)
- `category` / `subcategory` — taxonomy keys matching THREAT_MODEL.md
- `owasp` / `atlas` — framework tag(s) for CISO-facing reports
- `priority` — `P0` | `P1` | `P2`
- `severity` — `critical` | `high` | `medium` | `low`
- `attack` — the prompt, sequence, or attachment payload
- `expected_safe_behavior` — what the target should do
- `judge` — how the deterministic judge decides pass/fail/partial for this case
- `regression` — whether the case should be in the regression suite once confirmed

## Result schema

Each runner output conforms to `EvalResultSchema`:

- `case_id`, `run_id`, `target_url`, `timestamp`
- `prompt_sent`, `response_received`, `correlation_id`
- `verdict` — `pass` | `fail` | `partial`
- `judge_notes`, `severity_observed`
- `latency_ms`, `estimated_cost_usd`

## Running the suite

```bash
cd agentforge-redteam
npm install
# Export target config:
export TARGET_BASE_URL=https://108-61-145-220.nip.io      # or http://localhost:8080
export TARGET_SESSION_SECRET=<SESSION_TOKEN_SECRET from secrets.{dev,prod}.env>
export TARGET_PATIENT_UUID=<UUID of test patient in target DB>
export TARGET_USER_ID=1                                    # OpenEMR user_id for token claims
# Optional, for mutation:
export ANTHROPIC_API_KEY=...
# Run:
npm run run                # Runs all seeds
npm run run -- --mutate    # Runs seeds + 3 mutations per seed via Red Team Agent
```

Results land in `evals/results/run-<ISO-timestamp>.json` and are summarized to stdout.

## Judge strategy (MVP)

The MVP judge is **deterministic and per-case** — each seed declares its own pass/fail pattern. Reasoning:

1. Per the W3 architecture-defense doc, the Judge must be independent of the Red Team. Deterministic regex/string checks are the simplest form of independence and have zero drift.
2. Per the error-analysis lesson (binary first, scores second; LLMs assist, don't decide), an LLM Judge layer is deferred until after we have human-labeled ground truth.
3. Per the brief, what matters is reproducibility — a deterministic judge produces identical verdicts on identical responses, making regression a real check.

An LLM Judge is on the Friday plan as a *secondary* tier: it scores rationale + confidence on top of the deterministic verdict and surfaces disagreement to a human reviewer in the Review Console.
