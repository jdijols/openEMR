# Clinical Adversary (MVP)

**Clinical Adversary** is the standalone multi-agent adversarial security platform that continuously red-teams the W1/W2 Clinical Co-Pilot. Week 3 ships the MVP prototype: the **Red Team Agent** and a deterministic Judge as the first live agent role, plus a runner against `./evals/` seed cases. The Orchestrator, Documentation Agent, full LLM Judge, Review Console, and findings ledger are on the Friday plan.

> **Naming note:** "AgentForge" is the Gauntlet AI program/cohort designation; "Clinical Adversary" is the product itself. The W1/W2 product (also built in this cohort) is called "Clinical Co-Pilot." The directory is named `agentforge-redteam/` for historical and code-organization reasons, but it holds the Clinical Adversary platform.

## Layout

```
agentforge-redteam/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── target_client.ts    # Black-box HTTP client (mints HMAC tokens, parses SSE)
    ├── judge.ts            # Deterministic per-case judge
    ├── red_team_agent.ts   # Seed-mutation engine (Claude Haiku)
    └── run.ts              # Eval-suite runner
```

## Architecture (MVP, defended in ../W3_Architecture-Defense.md)

```
seed case (JSON)  ─┐
                   ├──▶ Red Team Agent ──▶ target_client ──HTTPS──▶ deployed Clinical Co-Pilot
mutation (Claude) ─┘                                                       │
                                                                            ▼
                                                                    SSE response
                                                                            │
                                                  Judge (deterministic) ◀───┘
                                                          │
                                                          ▼
                                                  results JSON → ../evals/results/
```

Target is treated as a **black box over HTTPS** — no shared code with the W2 target's runtime. The only coupling is the HMAC session-token signing contract (`SESSION_TOKEN_SECRET` mirrored from the target's env).

## Running

```bash
cd agentforge-redteam
npm install

export TARGET_BASE_URL=http://localhost:8080            # or https://108-61-145-220.nip.io
export TARGET_SESSION_SECRET=<SESSION_TOKEN_SECRET from secrets.{dev,prod}.env>
export TARGET_PATIENT_UUID=a1a5fc5c-8a37-4bb8-8194-1e93b86ee90e
export TARGET_USER_ID=1
# Optional:
export ANTHROPIC_API_KEY=<your-key>      # only needed for --mutate
export MUTATION_COUNT=3                  # mutations per seed (default 3)

npm run run                              # seeds only
npm run run -- --mutate                  # seeds + Red Team mutations
```

Results are written to `../evals/results/run-<ISO-timestamp>.json` matching the `RunSummarySchema` in [`src/eval_schema.ts`](src/eval_schema.ts).

## What this MVP demonstrates

1. **Live black-box adversarial testing** — the runner mints valid session tokens and hits the deployed `/chat` endpoint exactly the way a real attacker would.
2. **Three distinct attack categories** — prompt injection (LLM01), data exfiltration (LLM02), identity exploitation (LLM01/07) — exercising the brief's Stage 3 hard gate.
3. **One live agent role** — the Red Team Agent generates mutations via Claude Haiku, preserving attack intent while changing surface form. This is the brief's "not a static payload list" requirement.
4. **Deterministic Judge as v1** — per-case pattern rules with zero LLM drift, satisfying the brief's "results must be reproducible" requirement and the error-analysis lesson's "binary first, scores second."
5. **Structured findings** — each result is schema-validated, ready for downstream consumption by the Orchestrator (Friday).

## On the Friday plan (NOT shipped in MVP)

- **LLM Judge tier** — adds rationale + confidence on top of the deterministic verdict; calibrated against hand-labeled ground truth (30 cases).
- **Orchestrator Agent** — reads run summaries, scores coverage gaps, selects next campaign focus.
- **Documentation Agent** — converts confirmed exploits into `VULN-NNN.md` reports with recommended fix.
- **Findings ledger** (Postgres) — versioned attacks, verdicts, vulnerability lifecycle state machine.
- **Review Console** — operator UI for failure-taxonomy drill-down + trace journaling per the error-analysis lesson.
- **Document-upload attack vector** — exercises P0-1b (indirect injection) and P0-4a (poisoned `propose_writes`), which require document-pipeline wiring.
- **Multi-turn campaigns** — conversation-state continuation in the runner.

See [`../W3_Architecture-Defense.md`](../W3_Architecture-Defense.md) for the full multi-agent target architecture and [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the Friday-final commitment.
