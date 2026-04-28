# Stage 4 — users and use cases (process pointer)

**Purpose:** Index entry for the **Gauntlet AgentForge Stage 4 hard-gate deliverable** at [`USERS.md`](../../../USERS.md) (repo root). Stage 4 requires a concrete target user, workflow, and use cases — each with an explicit defense of why a conversational agent beats a dashboard for that job. This file is the **process trail** pointer at that deliverable: it records how `USERS.md` is meant to be read and how it chains to Stage 5 and the Stage 3 audit.

**Status:** Complete for the Stage 4 hard gate. `USERS.md` defines **Dr. Maya Reynolds** (adult outpatient primary care), a **pre-room → in-room → post-room** journey, three journey-shaped use cases (UC-A through UC-C), sample physician/agent messages, non-goals and refusals, **`AUDIT.md` cross-check** (including the expansion from read-only audit posture to **narrow, physician-confirmed writes**), and **Stage 5 traceability** requirements.

---

## 1. How to read `USERS.md`

- **Source of truth for Stage 5:** Every agent capability in `ARCHITECTURE.md` must map to a row in §4 (use-case table) or an explicit non-goal in §7.
- **Governing audit:** [`AUDIT.md`](../../../AUDIT.md). The **Audit Cross-Check** and **Stage 5 Traceability** sections in `USERS.md` name the findings that proof must address (auth paths, PHI boundaries, write authorization, logging, data quality).
- **Write scope (V1):** After explicit physician confirmation only: chief complaint / reason for visit; vitals including pain, height, weight; tobacco smoking status; allergy add or reaction/severity update. No immunizations; no allergy delete/resolve/inactivate. Confirmation authorizes an **attempted** write; the agent reports OpenEMR accept vs reject.
- **Capture boundary:** Physician-controlled dictation, **physician voice only** — no patient audio, no retained audio. The physician may **repeat or summarize** patient-provided facts into the transcript; patient speech is not captured or used to trigger writes.

---

## 2. Decisions (durable)

Long-form pivot log: [`journal/week-1/0428-T1700-stage4-users-deliverable.md`](journal/week-1/0428-T1700-stage4-users-deliverable.md).

- **Persona:** Adult primary care (family/internal medicine), returning adult patients, non-emergent visit types — aligned with the case-study “dense chart / what changed” scenario, not ED or narrow specialty.
- **Product shape:** Journey-based use cases (pre-room briefing, in-room transcript with proposals + confirmations, post-room continuation in the same thread) rather than visit-type-specific rows only.
- **Recording-centered MVP:** In-room experience is load-bearing for “why conversation”; scope was trimmed elsewhere (e.g. immunizations out, narrow writes only) to keep the project feasible.

---

## 3. Checklist (maintenance)

- [x] `USERS.md` at repo root is the hard-gate artifact (not a duplicate under `Documentation/AgentForge/`).
- [x] README process trail row **7** points here and to `USERS.md`.
- [x] Audit cross-check acknowledges writeback expansion and Stage 5 proof obligations.

---

## Links

- Hard-gate deliverable: [`USERS.md`](../../../USERS.md)
- Stage 3 audit: [`AUDIT.md`](../../../AUDIT.md)
- Presearch / forward checklist: [`03-presearch-checklist.md`](03-presearch-checklist.md)
- Journals: [`journal/`](journal/)
