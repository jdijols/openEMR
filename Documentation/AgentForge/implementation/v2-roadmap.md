---
status: planning artifact, not a commitment
last-updated: 2026-05-03
---

# AgentForge V2 — Forward Roadmap

## Purpose

Capture the post-V1 surface for the Clinical Copilot. V1 ships against the Week 1 brief's narrow scope: chart-data verification, three use cases (UC-A pre-room, UC-B in-room, UC-C post-room), five confirmed-write targets, deferral on general medical knowledge questions. V2 deepens what V1 proved — extending the propose → confirm → write contract across the full patient chart so the agent can read, create, update, and delete every data type a clinician touches in a chart workflow. V3 reaches beyond the chart, starting with external evidence grounding.

This is a **planning artifact**, not a binding plan. Each sub-version has a fit note and a rough effort estimate. Use this as the starting point for V2 scoping; once a V2 brief lands, this doc gets superseded by a real V2 PRD + task list in the same shape as V1's [TASKS.md](../../../TASKS.md).

## Anchoring assumptions

- V1 has shipped per [Submission-Checklist.md](Submission-Checklist.md).
- The four V1 verification layers stay in place; V2 extends them, doesn't replace them.
- The active-chart binding model from PRD §8.1 is preserved; cross-patient leakage remains a stop-the-line invariant.
- The propose → confirm → write contract is preserved for every write target, including every V2 addition.
- Real-PHI deployment posture (BAA, retention, self-hosted Langfuse) is a separate workstream from feature additions; addressed in the cross-version operational section.

---

## V2 — Full chart CRUD coverage

**Goal:** the agent can perform read, create, update, and delete operations against every major data type in a patient's chart, sequenced into three sub-versions by clinical centrality and architectural distance from V1.

### Cross-cutting V2 invariants

These hold for every V2 surface and don't need to be re-decided per data type:

- **Same propose → confirm → write contract.** Every write target in V2 routes through the existing pipeline: agent proposes a typed payload, CUI renders a confirmation card, the PHP module executes the write under the physician's existing OpenEMR session and ACL. No autonomous writes, ever.
- **Same UUID-citation gate.** Every read returns rows with UUIDs; every claim referencing a row must cite its UUID; the verification layer's citation enforcement gate operates unchanged. New data types register a new source family; the gate logic does not change.
- **Same active-chart binding model.** Every V2 read and write is bound to the active patient's chart. Cross-patient leakage remains a stop-the-line invariant.
- **Negative-claim regex extends with each data type.** V1 covers allergies and labs. Each V2 data type adds patterns ("no current medications," "no active problems," "no scheduled immunizations") so negative claims remain backed by tool evidence rather than model intuition.
- **Eval delta per data type.** Each new CRUD surface adds 2–3 deterministic eval cases (happy path, refusal/empty path, error path). V2 totals roughly 25–30 new eval cases — comparable to V1's full curated suite size.

### V2.1 — Clinical core

| Data type | OpenEMR table | Notes |
|-----------|---------------|-------|
| Allergies | `lists` (type='allergy') | V1 ships add/update only. V2.1 **closes CRUD** with delete/resolve/inactivate. Destructive actions require the clinician to retype the allergen name in the confirmation card. |
| Medical problems | `lists` (type='medical_problem') | ICD-10 lookup for add/update. Same propose→confirm→write shape as allergies. |
| Medications | `lists` (type='medication') | RxNorm-aware lookup. Operations are add/update/inactivate — true delete is avoided because clinical history matters. |
| Prescription records | `prescriptions` | **CRUD on prescription records** (drug, dose, refills, dispense history) — *not* e-prescribing new scripts to a pharmacy. The distinction matters: prescription records are chart data; e-prescribing is a regulated transmission act with DEA controls and e-prescribing infrastructure (deferred indefinitely; see "What's intentionally NOT on this list" below). |
| Immunizations | `immunizations` | CVX/MVX vaccine code lookup. CDC ACIP schedule context helpful for read but not required for write. |

**Why first:** highest clinical value, cleanest verification fit (each row already has a stable identifier), strongest continuity with V1's existing allergy CRUD work.

**Effort estimate:** ~2–3 weeks end-to-end including eval cases, code lookups (RxNorm, ICD-10, CVX/MVX), and confirm-flow UX for destructive actions.

### V2.2 — Care coordination

| Data type | OpenEMR table | Notes |
|-----------|---------------|-------|
| Care team | `users` ↔ `patient_data` link, plus dedicated care-team join table if present | CRUD on which providers/staff are on a given patient's care team. Read is straightforward; writes require role validation (don't add a non-licensed staff member as a clinical owner). |
| Treatment intervention preferences | May not exist as a dedicated table — likely lives in `lists` with a custom type, or requires a small schema addition | Patient preferences for *how* treatments are delivered (prefers oral over injectable, won't do MRI without sedation, declines opioids). **Schema audit required before V2.2 ships.** |
| Care experience preferences | Same caveat as above | Patient preferences for the visit experience (interpreter needed, accessibility accommodations, preferred communication channels, religious/cultural considerations). **Schema audit required before V2.2 ships.** |

**Why second:** builds on the clinical-core CRUD pattern but introduces preference modeling and care-team role validation. The two preference data types may need new schema; that work is contained inside V2.2 and doesn't block V2.1.

**Effort estimate:** ~2–3 weeks if preferences map to existing structures; +1–2 weeks if new schema is required.

### V2.3 — Operational chart

| Data type | OpenEMR table | Notes |
|-----------|---------------|-------|
| Demographics | `patient_data` | CRUD on name, DOB, address, phone, email, etc. Most fields aren't clinical claims, so the citation gate doesn't fire the same way — but the propose→confirm→write contract still applies. Audit semantics differ slightly (PII updates vs. clinical updates) but the underlying audit log captures both today. |
| Billing / insurance | `insurance_data` | CRUD on policy info, group numbers, copays, eligibility flags. **Not** processing claims (that's a separate workflow with payer integration; out of scope). PHI-financial classification — confirm-flow language should reflect that. |
| Patient messages | Portal message tables (`onsite_messages` and related) | Different verification semantics than clinical data — citations don't apply the same way. Agent drafts message content; physician approves before send. Send is a write; subsequent edits to drafts are CRUD on the draft record. |
| Patient reminders | `patient_reminders` (or rules-engine equivalent) | Appointment reminders and health-maintenance reminders. CRUD on reminder records and per-patient preferences. Some reminders are rules-driven (do not let CRUD invalidate the rule engine's state). |

**Why last:** mostly operational rather than clinical, and the data shapes diverge most from V1's clinical-CRUD pattern (messages especially). Pushing these last lets the V2.1 / V2.2 patterns harden before tackling the data types that least resemble V1.

**Effort estimate:** ~3–4 weeks. Messages alone are ~1 week because the draft/approve/send flow is its own UX pattern.

---

## V3 — Beyond chart CRUD

V3 is everything that requires more than extending the V1 pipeline across new data types. Each candidate below was originally tagged as V2 in earlier drafts; V3 gives them a dedicated design pass instead of bolting them onto a chart-CRUD release.

### V3.1 — External evidence grounding (the headline V3 candidate)

**Goal:** ground general medical knowledge questions in peer-reviewed sources, the same way V1 grounds patient-specific claims in the chart.

**Why V3 and not V2:** V1's verification layer only catches *chart-fidelity* failures. General knowledge questions ("what's the recommended A1c target for a 68-year-old with type 2 diabetes and hypertension?") have no chart record to verify against, so V1 falls back to deferral language. Closing that gap is high value but introduces a different class of safety question — source currency, hallucinated-citation risk, attribution semantics, external-URL citation rendering. V2 chart CRUD reuses V1's verification model wholesale; V3.1 needs a separate design pass.

**Architectural fit:** clean extension of the citation gate but a new safety layer in its own right. The gate already operates on UUIDs from any tool source; a new tool — `lookup_clinical_evidence` — that returns rows with their own UUIDs (alongside `get_allergies`, `get_problems`, etc.) extends the same logic. The new work is everything the gate doesn't cover: source-pack registration for external sources, currency tracking, external-URL citation rendering in the CUI, evaluation cases that don't depend on live PubMed.

**Source choices**, in order of accessibility:

| Source | Cost | API | Notes |
|--------|------|-----|-------|
| **PubMed BioC** | Free | REST (JSON/XML) | ~3M full-text articles. Most ready-to-ship option. |
| **OpenEvidence** | Free for U.S. HCPs | App / web only, no API | Good content quality but not API-integratable today. |
| **UpToDate Connect** | Paid enterprise | REST | Best content but cost barrier; revisit if a clinic partner sponsors. |
| **Cochrane Library** | Mixed (summaries free) | Limited API | Highest evidence-quality bar (systematic reviews). |

V3.1 should default to **PubMed BioC** as the integration target. Other sources can layer on later behind the same `lookup_clinical_evidence` tool surface.

**Implementation sketch:**

- New tool [`agentforge/api/src/tools/lookup_clinical_evidence.ts`](../../../agentforge/api/src/tools/). Input: query string + optional condition / treatment hints. Output: 1–3 article rows, each with UUID, title, authors, journal, year, evidence level (RCT / systematic review / guideline / etc.), URL, summary excerpt.
- Citation rendering: new `external_citation` hint type in source pack; CUI renders these as clickable links opening in a new tab (vs. in-chart navigation for chart UUIDs).
- System prompt update: explicit routing for treatment-threshold and guideline questions to invoke the evidence tool; deferral language stays as the fallback when no evidence row matches.
- Verification: no change to the gate. Citation enforcement is shape-correct.
- Eval: 2–3 new cases — happy path (treatment threshold question with cited guideline), refusal path (specific medication recommendation that still defers), evidence-not-found path (no source row matched, deferral language used).
- Observability: new tool span; no other change.

**Effort estimate:** 2–3 weeks end-to-end including eval cases and citation-rendering UX. Most of the cost is the rendering UX (external URLs vs. in-chart navigation) and writing eval cases that don't depend on live PubMed.

**Open design questions:**

- How does the model decide between "answer with chart data" and "answer with literature"? Probably explicit routing in the system prompt rather than letting the model judge.
- Latency budget: PubMed BioC adds a ~300–800ms tool turn. Acceptable for V3.1 but doubles UC-A briefing time if not careful.
- Required vs. optional citations: should treatment-threshold questions *require* an evidence citation (no answer without a source) or *fall back to deferral* if no source is found? Required is safer; fallback is friendlier.
- Caching: a same-day cohort question hits the same evidence rows for many patients — a small in-memory cache cuts cost meaningfully.

### V3.2 — Verification layer deepening

Open gaps from [VERIFICATION.md](../../../VERIFICATION.md) §"What verification does NOT catch":

- **Fidelity-drift detection** — citation valid, but content paraphrased away from source. Needs a structured-extraction pass (small model or regex-shape extractor) that compares generated text against cited row values for dose / frequency / numeric fidelity. ~3–5 days; meaningful addition to verification logic, not a one-line fix.
- **Drug-drug interactions** — RxNorm + DrugBank or similar. Adds latency and a non-trivial knowledge base; couples naturally with V3.1 evidence infrastructure.
- **Pediatric vs. adult vital ranges** — V1 uses adult ranges only. Extending requires patient demographics in the verification context (already available in `ClinicalToolEvidence`) plus a small lookup table. ~½ day.
- **Streaming verification** — token-level commit-or-rollback. Significant rewrite; defer until streaming UX is actually needed.

(Note: broader negative-claim coverage was an open V2-era gap, but it folds into V2's cross-cutting invariants — each new data type extends the regex set as part of that data type's V2.x work, not as a separate V3 effort.)

### V3.3 — Workflow expansion

- **Multi-encounter context.** V1 binds to one active encounter. Cross-encounter Q&A ("show A1c trend over the last year", "did metformin compliance change after the dose increase") requires either expanded chart context per turn or a multi-turn binding model. ~1 week including binding-model design.
- **Patient-side audio capture (with explicit consent).** V1 is physician-only by design — no patient audio, no retained audio file, no ambient listening. With proper consent UX and retention policy, ambient capture during the visit unlocks transcript-driven note drafts. Couples with encounter-notes drafting (see below).
- **Encounter notes (long-form).** Different pipeline shape than V2 chart CRUD — drafts, signoff state, not propose→confirm→write. Couples naturally with ambient capture above.
- **Day-view briefing.** V1 renders an empty state with no chart open. A pre-day briefing across all scheduled patients requires a new bounded read scope (cross-patient calendar) outside the active-chart binding model. Architectural decision: either expand the binding model or add a separate "day-view session" with its own scope.
- **Specialist workflows.** V1 anti-persona list includes specialists, ED, pediatric, surgical, dental, mental-health-only. Each is a separate persona with different chart-context shapes; this is not a generic extension but a fork-per-specialty.

---

## Cross-version operational and compliance

These apply to V2 and V3 alike — they're deployment posture, not feature work.

- **Real-PHI deployment posture.** Per [ARCHITECTURE.md](../../../ARCHITECTURE.md) Compliance-2, real-PHI deployments default back to self-hosted Langfuse. Formalize the swap: documented BAA, retention policy, audit log purge schedule, breach-detection alerting. Independent of feature work but blocks any non-demo deployment.
- **Cost-rate accuracy and model rotation.** V1 punch list includes the [cost_estimate.ts](../../../agentforge/api/src/agent/cost_estimate.ts) heuristic fix. Formalize a per-model pricing table sourced from a single vendor-neutral location, plus a model-rotation strategy (e.g., Haiku for tool-routing turns, Sonnet for response generation).
- **CI gate for the eval suite.** Partly on V1 punch list. V2 adds **production-trace replay** — sampled real turns re-run through the deterministic eval rules to catch model regressions in the wild.
- **Multi-region / scaling.** V1 is single VPS + Compose. Scaling per [ARCHITECTURE.md](../../../ARCHITECTURE.md) "Cost snapshot": managed Postgres + replicas at ~1k MAU, regional cells at higher tiers.

---

## What's intentionally NOT on this list

- **E-prescribing new scripts to a pharmacy.** V2.1 covers CRUD on existing prescription *records* in the chart, not transmitting new scripts. E-prescribing requires a CDS rules engine, e-prescribing infrastructure (Surescripts or equivalent), DEA controls for controlled substances, and insurer coverage check. Multi-month workstream of its own; defer indefinitely.
- **Billing claim submission.** V2.3 covers CRUD on insurance records in the chart. Submitting claims to payers, eligibility checks against payer APIs, and remittance processing are out of scope.
- **Orders (lab / imaging).** Same shape as e-prescribing — needs CDS rules, lab/imaging integration, result routing. Not a chart-CRUD problem; defer indefinitely.
- **Multi-agent orchestration** ("planner agent + verifier agent + tool agent + …"). V1's verification model is deterministic, not agentic. Adding LLM-based verifiers undermines the auditability story that the four-layer pipeline gives us.
- **Autonomous writes.** The confirmed-write contract is V1's defining safety property. V2 and V3 may expand the *set* of confirmed write targets but do not relax the confirmation requirement.
- **Real-time chart-data sharing across organizations.** Out of scope and out of likely project lifetime.
- **Generic "ChatGPT for the EMR".** V1 succeeds because it is journey-shaped and narrow. A general-purpose chat over OpenEMR is an anti-goal.

---

## How to use this doc

When V2 scoping starts, treat each V2.x sub-version as a workstream. The recommended starting point is **V2.1 (clinical core)** — highest clinical value, cleanest verification fit, strongest continuity with V1's existing allergy CRUD work.

Pick V2.1, write a real PRD with stop-the-line invariants and eval cases, and break it into gates the way V1 was broken into G0–G7. Once V2.1 ships, the V2.2 and V2.3 PRDs reuse the same shape with data-type-specific deltas. Don't treat this doc as authoritative once V2 work begins — it's a starting point, not a contract.

V3 PRDs come later and follow the same shape, with V3.1 (external evidence) as the recommended starting workstream.

---

## Cross-references

- [VERIFICATION.md §7](../../../VERIFICATION.md) — the V1 limitation that motivates V3.1 external evidence grounding.
- [USERS.md §7.1](../../../USERS.md) — V1 "does not include" list, source for V2 data-type candidates.
- [ARCHITECTURE.md](../../../ARCHITECTURE.md) — V1 architecture reference, including Compliance-2 and Cost-snapshot anchors used here.
- [TASKS.md](../../../TASKS.md) — V1 task list shape; V2 PRDs should follow the same gate structure.
- [Submission-Checklist.md](Submission-Checklist.md) — V1 ship gate.
