# Gate 5 manual smoke — STT + UC-C (G5-08)

**Purpose:** Close **G5-08** in `clinical-copilot-task-list.md` after automated tests are green.

## Preconditions

- Agent Postgres migrations through **`003_gate5_transcripts.sql`** (host: `POSTGRES_URL_MIGRATE='postgresql://agentforge:agentforge@127.0.0.1:15432/agentforge' npm run db:migrate` from `agentforge/api`; in-container: `npm run db:migrate` with the compose URL).
- `secrets.dev.env` (or prod): `STT_PROVIDER` is one of `mock` / `assemblyai` / `deepgram`. `mock` works without a real account but still requires a non-empty `STT_API_KEY` per the env schema. **`assemblyai` is the current real-STT default** (Deepgram pending vendor approval).
- API restarted after env / migration changes; `GET /health` shows `postgres: reachable`.

## Checklist (PRD §5.8 / §6.4 / UC-C)

1. Open a cohort patient chart → open rail → wait for the handshake banner to clear. **Start dictation should be enabled immediately** — no chat round-trip required (post `mic-enabled-on-load`). The textarea and Send button should also be usable while the auto-brief is still loading.
2. **Tap mode:** Start dictation → speak a short phrase → Stop dictation → confirm the `[dictation] …` user line appears and final text looks sensible (`mock` provider embeds a byte-length hint; `assemblyai` returns the actual utterance with punctuation).
3. **Hold mode:** Hold button → speak → release → same as above.
4. **Provider swap (optional):** Flip `STT_PROVIDER` between `mock` / `assemblyai` / `deepgram` (with a real key), restart the API, repeat steps 2–3.
5. **Voice confirm:** With a **pending proposal** visible, dictate **"confirm"** → proposal shows **Accepted (voice)** and OpenEMR path matches **G4** behavior.
6. **Recap:** Type **"What did we capture"** (or **visit recap** / **capture summary**) → assistant shows **What we captured** with **confirmed / rejected / unresolved / refusal** rows.
7. **S3 sanity:** On the host, confirm no new `.wav` / `.webm` / etc. files appeared under the API working directory or mounted volumes from this session (`find` / IDE search).
8. **Failure-mode sanity:** If the banner ever shows `Dictation init failed (<code>)` or `Dictation failed (<code>)`, the API stderr now logs an upstream-body-rich `stt_finalize_failed` line — paste both into the evidence section.

## Evidence

- Paste **correlation ids** or a short screen recording note below; mark **G5-08** `[x]` in the task list.

---

_Engineer: complete after run._
