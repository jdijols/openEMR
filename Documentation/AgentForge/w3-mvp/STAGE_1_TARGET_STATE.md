# Stage 1 — Stand Up the Target

> Brief requirement: "Ensure your Clinical Co-Pilot from Weeks 1 and 2 is running in a testable state — locally and deployed. Document any changes made to bring the system into a testable state. This becomes part of your README and your threat model context."

## Target identity

The Week 3 adversarial platform tests the **W1/W2 Clinical Co-Pilot** — the OpenEMR fork built across Weeks 1–2, deployed to a Linux VPS, with a React CUI iframe in the chart rail and a Node/TypeScript agent backend. Architecture and decisions are documented in [`W2_ARCHITECTURE.md`](../../../W2_ARCHITECTURE.md) (target system) and [`W1_ARCHITECTURE.md`](../../../W1_ARCHITECTURE.md) (chart-tools baseline).

## Deployed URLs (submit these with every checkpoint)

| Surface | URL | Role | Verified |
|---|---|---|---|
| **Deployed target application** | `https://oe.108-61-145-220.nip.io/` | OpenEMR chart shell — the URL graders open | 302 → `/interface/login/login.php` ✓ |
| Agent API | `https://108-61-145-220.nip.io/` | Hono backend; chat, proposals, evidence retrieval | `/health` → 200, all deps `ok` ✓ |
| Health probe | `https://108-61-145-220.nip.io/health` | Liveness + dep status | `providers: {llm: anthropic, stt: assemblyai}`, `deps: {openemr_module: ok, postgres: reachable, langfuse: ok}` ✓ |

Last prod redeploy: 2026-05-11 (HEAD `0f5634014`) — W2 submission-hardening pass. See [process journal](../process/journal/week-2/0511-T1930-w2-submission-hardening-and-prod-redeploy.md).

## Local stack status

Per `docker compose ps` against `docker/development-easy/` + the `docker/agentforge/` override, all 11 services running:

```
openemr (8300/9300)         healthy   3 days
agentforge-api              running   5 days   (npm run dev started manually inside container)
caddy (8080)                running   5 days
postgres (15432)            running   5 days   pgvector/pgvector:pg16 — hosts Langfuse + AgentForge data
langfuse                    running   5 days   self-hosted v2.95.11
mysql/mariadb (8320)        healthy   5 days   OpenEMR DB
phpmyadmin (8310)           running   5 days
couchdb (5984/6984)         running   5 days
mailpit, openldap, selenium running
```

Local agent API is reached via Caddy on `http://localhost:8080` (matches the `AGENTFORGE_PUBLIC_HOSTNAME` Caddyfile rule). The `agentforge-api` container starts on `sleep infinity` by design — `npm run dev` is started manually inside it. Documented in user memory `reference_agentforge_urls.md`.

## Changes made to bring the system into a testable state

**None for Stage 1.** The W2 target is treated as a network black box. The Red Team Agent will reach it over the same HTTPS surface a real attacker would see. No target-side code changes are required to ship the Stage 1 hard gate.

This is a deliberate architectural choice, not an oversight: keeping the target unmodified during testing means (a) we exercise the *real* defense posture, not a watered-down test build; (b) the platform can be lifted out and pointed at any future Clinical Co-Pilot version (or any other LLM application with similar contract) with no integration work.

## Changes deferred to later stages (NOT blocking Stage 1)

As the platform matures we may introduce these small target-side concessions to keep test traffic clean. They are listed here so a peer reviewer sees the full picture; none are required to satisfy the Stage 1 hard gate.

| Change | Why we might add it | Decision point |
|---|---|---|
| `x-redteam-session-id` request header recognized by the API | Tags adversarial traffic in Langfuse traces + OpenEMR audit log so post-hoc forensics separates test from real | Stage 3 (when we start producing trace volume) |
| Sandbox-mode flag (`AGENTFORGE_SANDBOX=true`) where `propose_writes` is logged but never persisted to FHIR | Prevents adversarial test runs from polluting the demo chart and triggering false-positive idempotency hits | Stage 4 once we know cost envelope for full FHIR-write attacks |
| Dedicated `red-team` service account + handshake token | Authenticates platform traffic without a real browser session; revocable independently of physician accounts | Stage 3 if/when full handshake redemption is needed for multi-turn attacks |

All three are non-invasive: a header read, an env flag with a conditional in the write executor, and a new row in `users_secure`. None alter the W2 architecture or eval surface.

## Authentication strategy for the adversarial platform

For the initial MVP, the platform will reach the live target through one of two paths:

1. **Direct API hit** (`/chat`, `/health`, `/status`) — endpoints that do not require a redeemed handshake token (`/health`, `/status`) or that accept a service-token (`/chat` with a programmatically-issued token).
2. **Synthetic patient binding** — all attacks bind to a single dedicated "red-team" patient seeded in the demo chart. Cross-patient exfiltration attacks will use a second patient as the leak target. No real PHI is involved (W2 demo posture remains synthetic-data-only).

The platform never logs into a real physician account, never hits a production OpenEMR install, and never reads/writes real PHI.

## Stage 1 hard gate — status

> "Your deployed target application URL must be submitted with every checkpoint. The adversarial platform must be running tests against a live system, not just a mock."

**Met.** Deployed target URL: `https://oe.108-61-145-220.nip.io/`. Confirmed live and healthy on 2026-05-12. All subsequent stages will exercise this live system, not a mock.
