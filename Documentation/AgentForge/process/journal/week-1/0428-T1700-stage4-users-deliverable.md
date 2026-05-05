---
date: 2026-04-28
topic: Stage 4 USERS.md hard gate + process trail 07
related_milestone: process/milestones/week-1/07-stage4-users.md
---

# Stage 4 users deliverable — session journal

## Goal

Lock the AgentForge Stage 4 hard gate: a repo-root [`USERS.md`](../../../../../USERS.md) that defines the clinical copilot’s target physician, journey-shaped workflow (pre-room, in-room, post-room), use cases with “why not a dashboard,” non-goals, audit cross-check, and Stage 5 traceability — then mark it as the formal deliverable, clarify in-room capture boundaries, and add **process/07** plus README trail row **7**.

## Context

Stage 3 produced canonical [`AUDIT.md`](../../../../../AUDIT.md). Stage 4 evolved from a read-only advisory framing to a **physician-voice transcript** with **narrow, confirmed EMR writes**, while keeping PHI and authorization constraints explicit for Stage 5.

## Key decisions

### Decision: V1 persona and antithesis

- **Prompt:** Lock adult-only primary care (family medicine / internal medicine) with returning patients and non-emergent visits; not ED, not specialists/surgeons/dentistry.
- **Recommendation:** Match the case-study “90 seconds between rooms” and rich prior-chart workflow; ED-first persona would fight the PDF scenario.
- **Outcome:** [`USERS.md`](../../../../../USERS.md) §2 primary persona (Dr. Maya Reynolds), §2.3 anti-persona.

### Decision: Journey-shaped use cases vs visit-type-only rows

- **Prompt:** Organize use cases around before room, in room, after room; transcript-centered in-room experience.
- **Recommendation:** Three UCs (UC-A pre-room briefing, UC-B in-room transcript + writes, UC-C post-room continuation) so Stage 5 traces capabilities to phases, not only to disease flavors.
- **Outcome:** [`USERS.md`](../../../../../USERS.md) §4 table; §3 narrative.

### Decision: Physician-only capture and narrow confirmed writes

- **Prompt:** Keep recording UX as differentiator; reduce scope elsewhere; chief complaint, vitals (incl. pain/height/weight), tobacco, allergies; no immunizations; everything write requires explicit confirm.
- **Recommendation:** No patient audio, no audio retention; accidental patient speech cannot trigger writes; writes are proposal → confirm → report OpenEMR success/failure.
- **Outcome:** [`USERS.md`](../../../../../USERS.md) §3.2, §4 UC-B, §5 samples, §7 non-goals/refusals; audit cross-check row for write expansion.

### Decision: Dictation boundary clarification

- **Prompt:** Final coherence — physician may repeat/summarize patient facts; patient speech not used for writes.
- **Recommendation:** One explicit sentence in §3.2 so architecture and refusals stay aligned.
- **Outcome:** [`USERS.md`](../../../../../USERS.md) §3.2 after accidental-capture sentence.

### Decision: Deliverable status and process pointer 07

- **Prompt:** Change status to deliverable; add `07-stage4-users.md` like Stage 3 audit pointer; update AgentForge README trail.
- **Recommendation:** README row 7 → `process/milestones/week-1/07-stage4-users.md` → root `USERS.md`; extend instructions for next milestone `08`.
- **Outcome:** [`Documentation/AgentForge/README.md`](../../../README.md), [`process/milestones/week-1/07-stage4-users.md`](../../milestones/week-1/07-stage4-users.md).

## Trade-offs and alternatives

- **Full visit audio with diarization** — Deferred: PHI, consent, and scope; physician-only dictation preserves the thread UX with lower blast radius.
- **Immunizations in V1** — Deferred per user: field/workflow complexity.

## Tools, dependencies, commands

_None this session._

## Files touched

- **Created:** `Documentation/AgentForge/process/milestones/week-1/07-stage4-users.md`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T1700-stage4-users-deliverable.md`
- **Modified:** `USERS.md`
- **Modified:** `Documentation/AgentForge/README.md`

## Outcomes

`USERS.md` is labeled the Stage 4 hard-gate **deliverable**, §3.2 states the physician may summarize patient facts without capturing patient speech for writes, and the AgentForge process trail includes **07** as the pointer to `USERS.md` with a dated journal for pivots.

## Next steps

- [ ] Stage 5: draft `ARCHITECTURE.md` with every capability traced to a `USERS.md` §4 row (or §7 non-goal).
- [ ] Implement confirmation gate, write paths, and failure reporting per UC-B and audit cross-check.
- [ ] Synthetic / hybrid patient data plan (per `AUDIT.md` DataQuality) to exercise returning-patient scenarios.

## Links

- Numbered milestone: [process/milestones/week-1/07-stage4-users.md](../../milestones/week-1/07-stage4-users.md)
- Deliverable: [`USERS.md`](../../../../../USERS.md)
- Audit: [`AUDIT.md`](../../../../../AUDIT.md)
