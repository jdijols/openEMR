---
date: 2026-04-29T23:52-05:00
gate: 2
status: code-complete (G2-12 manual smoke pending)
---

# Gate 2 — code-complete

Closes implementation + automated tests for [task list G2-01..G2-11 + G2-13](../../../../../TASKS.md#gate-2--first-vertical-read-slice-uc-a-spine). G2-12 (live cohort smoke) is the only remaining row and is gated on a real OpenEMR boot with an LLM API key configured.

## Test snapshot

| Suite | Files | Tests |
| ----- | ----- | ----- |
| `agentforge/api` Vitest | 11 | 31 / 31 |
| `agentforge/cui` Vitest | 3 | 15 / 15 |
| Isolated PHPUnit `tests/Tests/Isolated/Modules/AgentForge` | — | 19 / 19 |
| ESLint guard against `dangerouslySetInnerHTML` | — | fires on positive case |
| `npm run build` (CUI) → module `public/cui/` | — | green |
| `docker compose config` dev + prod merges | — | green |

## Operational topology landed alongside the gate

- Per-environment secrets via `${AGENTFORGE_SECRETS_FILE}` (`secrets.dev.env` / `secrets.prod.env`); `OPENEMR_MODULE_BASE_URL` set per env (host loopback for dev, internal Docker DNS `http://openemr` for prod).
- `openemr` joined to `agentforge_internal` in the override so the API container can S2S-reach OpenEMR for handshake redeem and Context Service.
- `docker-compose.prod.yml` runs the API container and fronts it with **Caddy as TLS reverse proxy** (Let's Encrypt automatic HTTPS for `${AGENTFORGE_PUBLIC_HOSTNAME}`); `agentforge-api` has **no published ports** — the public surface is Caddy on `:80`/`:443` only.
- New `docker/agentforge/Caddyfile` reverse-proxies the public hostname → `agentforge-api:3000`.

## Notable test additions (this chunk)

- `test/openemr/client.test.ts` — header trio (`X-Correlation-Id` / `X-Session-Token` / `X-Internal-Auth`) propagation, body shape, Zod negatives for both endpoints, and 503 mapping on network failure (no 5xx body leakage).
- `test/tools/get-identity-and-allergies.test.ts` — happy-path `{ok:true,data,source_packs}` shape per tool; cross-patient call makes **zero** HTTP requests (S1 invariant); `OpenEmrCallError` surface narrowed to `{ok:false,error:'openemr_error'}` (never throws to model).
- `test/agent/orchestrator.test.ts` — `vi.hoisted` + `vi.mock('ai')` to stub `generateText`; asserts tool wiring, JSON `{blocks:[...]}` parse, prose fallback, and correlation-id flow into the observability stub.
- `cui/src/api/client.test.ts` — handshake + chat header/body shape, single-flight dedupe of single-use launch codes (StrictMode safety), `501→api_misconfigured_llm`, `5xx→chat_failed`.
- `cui/src/chat/MessageList.test.tsx` — text + claim block render incl. citation suffix, no trailing parens when no citations, XSS escape on text blocks.
- `cui/src/chat/useHandshake.test.ts` — error states for missing api/launch/patient; happy path; `Storage.prototype.setItem` spy proves zero `localStorage`/`sessionStorage` writes (S5).

## Schema fix in flight

- `identityResponseSchema`'s `.transform` previously called `sourcePackSchema.parse` directly, which leaked `ZodError` past `safeParse` in the client. Schema now validates `source_pack` as an intersected shape on `data`, so `safeParse` traps malformed module responses cleanly.

## Loose ends knowingly deferred

- **G2-12 manual smoke** — needs real OpenEMR + cohort patient + `LLM_API_KEY` set. Topology, bundle, and automated tests are ready; this is operational verification, not new code.
- **`LLM_API_KEY`, `POSTGRES_URL`, `LANGFUSE_*`** in both env files remain `replace-me`; required only when those subsystems are actually exercised (chat, conversation store, traces).
- **API container baking** — prod overlay currently runs `npm ci && npm run build && node dist/index.js` on cold start; baking a real image lands in Gate 6 (`§7.1`).
