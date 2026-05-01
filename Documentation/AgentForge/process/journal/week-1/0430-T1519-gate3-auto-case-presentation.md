---
date: 2026-04-30
topic: Gate 3 G3-11 — auto case presentation on chart open (SOAP-style outpatient)
related_milestone: clinical-copilot-task-list.md (G3-11), PRD.md §1.3 §1.4 §4.2 §6.2
---

# Auto case presentation — implementation record

## Product intent

- Replace typed "Brief me" as the primary UC-A entry: **opening a chart with active pid auto-opens the rail** and triggers a compact **outpatient case presentation** (one-liner, interval, objective, assessment, visit topics from chart evidence only).
- **"Brief me"**, **"case presentation"**, **"present patient"** (message prefix) and **Refresh case presentation** call the same `POST /present-patient` pipeline. Server-side **cache** keyed by `(patient_uuid, sha256(session_token))`, TTL 30m; `force_refresh: true` bypasses cache.
- **§1.3 guardrail:** visit topics must not invent orders/diagnoses/prescriptions; prompt + verification enforce cite-only clinical claims.

## Technical summary

| Layer | Change |
| ----- | ------ |
| **OpenEMR** | `rail_container.html.twig`: pid watcher opens rail when `cur !== ''`; `openRail` schedules `postMessage({ type: 'AGENTFORGE_PRESENT_PATIENT' })`; iframe `load` repeats ping when rail open + pid set; initial `readPidProbe() !== ''` calls `openRail()` for direct chart landings. |
| **CUI** | `App.tsx`: message listener (same-origin), pending flush if pre-handshake; replaces thread on auto-present; refresh appends; brief-me regex branch. |
| **API** | `POST /present-patient`; `runCasePresentation` → `fetchCasePresentationData` (parallel `getIdentity` + 8 context reads) → `generateText` (no tools) → `verifyClinicalBlocks` → `case_presentation_cache`. |

## Automated verification

- `agentforge/api`: `npm test` includes `test/agent/case_presentation.test.ts`.
- `agentforge/cui`: `postPresentPatient` in `src/api/client.test.ts`.
- `composer phpunit-isolated -- --filter RailContainerStaticStructureTest` — asserts `AGENTFORGE_PRESENT_PATIENT`, auto `openRail` on pid transition, first-paint `readPidProbe()` gate.


## Manual done proof (still required for `[x]` G3-11)

Append **≥3** storyboard chart-open transcripts: identifiers + one cited **interval/problem/status** line each (no PHI paste beyond demo-safe labels).

## Key files

- `agentforge/api/src/agent/case_presentation.ts`, `case_presentation_fetch.ts`, `case_presentation_prompt.ts`, `case_presentation_cache.ts`
- `agentforge/api/src/app.ts` — `/present-patient`
- `agentforge/cui/src/api/client.ts`, `App.tsx`, `index.css`
- `interface/.../templates/rail_container.html.twig`
- `PRD.md` §1.3, §1.4, §4.2.1, §6.2.1
