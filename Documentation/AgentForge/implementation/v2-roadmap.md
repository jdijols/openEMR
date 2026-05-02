---
status: planning artifact, not a commitment
last-updated: 2026-05-02
---

# AgentForge V2 — Forward Roadmap

## Purpose

Capture post-V1 candidates for the Clinical Co-Pilot, organized by theme, with an architectural-fit note for each. V1 ships against the Week 1 brief's narrow scope: chart-data verification, three use cases (UC-A pre-room, UC-B in-room, UC-C post-room), five confirmed-write targets, deferral on general medical knowledge questions. V2 is the natural next surface — what the agent could become once V1 demonstrates the safe baseline.

This is a **planning artifact**, not a binding plan. Each candidate has a fit note (clean extension vs. requires redesign) and a rough effort estimate. Use this as the starting point for V2 scoping conversations; once a V2 brief lands, this doc gets superseded by a real V2 PRD + task list in the same shape as V1's [clinical-copilot-task-list.md](clinical-copilot-task-list.md).

## Anchoring assumptions

- V1 has shipped per [submission-checklist.md](submission-checklist.md).
- The four V1 verification layers stay in place; V2 extends them, doesn't replace them.
- The active-chart binding model from PRD §8.1 is preserved; cross-patient leakage remains a stop-the-line invariant.
- The propose → confirm → write contract is preserved for every write target, including any V2 additions.
- Real-PHI deployment posture (BAA, retention, self-hosted Langfuse) is a separate workstream from feature additions; surfaces below where it intersects.

---

## Theme 1 — Evidence-based citation (the headline candidate)

**Goal:** ground general medical knowledge questions in peer-reviewed sources, the same way V1 grounds patient-specific claims in the chart.

**Why now / why V2:** V1's verification layer only catches *chart-fidelity* failures. General knowledge questions ("what's the recommended A1c target for a 68-year-old with type 2 diabetes and hypertension?") have no chart record to verify against, so V1 falls back to deferral language — the system prompt instructs the model to redirect those questions to clinician judgment. That keeps V1 honest, but it also means the agent can't help with the kind of treatment-threshold questions a more capable co-pilot would ideally answer. V2 closes the gap without inviting "subjective AI recommendations."

**Architectural fit:** clean extension. The verification layer's citation enforcement already operates on a UUID set from any tool source. A new tool — `lookup_clinical_evidence` — that returns rows with their own UUIDs (alongside `get_allergies`, `get_problems`, etc.) extends the same logic. No verification redesign required.

**Source choices**, in order of accessibility:

| Source | Cost | API | Notes |
|--------|------|-----|-------|
| **PubMed BioC** | Free | REST (JSON/XML) | ~3M full-text articles. Most ready-to-ship option. |
| **OpenEvidence** | Free for U.S. HCPs | App / web only, no API | Good content quality but not API-integratable today. |
| **UpToDate Connect** | Paid enterprise | REST | Best content but cost barrier; revisit if a clinic partner sponsors. |
| **Cochrane Library** | Mixed (summaries free) | Limited API | Highest evidence-quality bar (systematic reviews). |

V2 should default to **PubMed BioC** as the integration target. Other sources can layer on later behind the same `lookup_clinical_evidence` tool surface.

**Implementation sketch:**

- New tool [`agentforge/api/src/tools/lookup_clinical_evidence.ts`](../../../agentforge/api/src/tools/). Input: query string + optional condition / treatment hints. Output: 1–3 article rows, each with UUID, title, authors, journal, year, evidence level (RCT / systematic review / guideline / etc.), URL, summary excerpt.
- Citation rendering: new `external_citation` hint type in source pack; CUI renders these as clickable links opening in a new tab (vs. in-chart navigation for chart UUIDs).
- System prompt update: explicit routing for treatment-threshold and guideline questions to invoke the evidence tool; deferral language stays as the fallback when no evidence row matches.
- Verification: no change. Citation enforcement is shape-correct.
- Eval: 2–3 new cases — happy path (treatment threshold question with cited guideline), refusal path (specific medication recommendation that still defers), evidence-not-found path (no source row matched, deferral language used).
- Observability: new tool span; no other change.

**Effort estimate:** 2–3 days end-to-end including eval cases and minimal UI work. Most of the cost is the citation-rendering UX (external URLs vs. in-chart navigation) and writing eval cases that don't depend on live PubMed.

**Open design questions:**

- How does the model decide between "answer with chart data" and "answer with literature"? Probably explicit routing in the system prompt rather than letting the model judge.
- Latency budget: PubMed BioC adds a ~300–800ms tool turn. Acceptable for V2 but doubles UC-A briefing time if not careful.
- Required vs. optional citations: should treatment-threshold questions *require* an evidence citation (no answer without a source) or *fall back to deferral* if no source is found? Required is safer; fallback is friendlier.
- Caching: a same-day cohort question hits the same evidence rows for many patients — a small in-memory cache cuts cost meaningfully.

---

## Theme 2 — Write target expansion

V1 ships five confirmed-write targets: chief complaint, vitals (incl. pain / height / weight), tobacco status, allergy_add, allergy_update. The "V1 does not include" list in [USERS.md §7.1](../../../USERS.md) names the deferred surfaces.

| Target | Architectural fit | Effort | V2 priority |
|--------|------------------|--------|-------------|
| Immunizations | Extends the propose→confirm→write pipeline; needs vaccine-code lookup + schedule context | 3–5 days | **High** — most-requested clinical extension |
| Allergy delete / resolve / inactivate | Same pipeline; needs extra confirmation UX (clinician types the allergen name before delete) | 1–2 days | Medium — V1 conservatism is defensible; not urgent |
| Encounter notes (long-form) | Different pipeline shape — drafts, signoff state, not propose→confirm→write | 1–2 weeks | Medium — couples naturally with ambient capture in Theme 4 |
| Orders / prescriptions | Out of scope indefinitely — needs CDS rules engine, e-prescribing, insurer coverage check, BAA review | Multi-month | **Defer indefinitely** |
| Billing codes / encounter close | Same as orders | Multi-month | **Defer indefinitely** |

**Architectural fit varies.** Immunizations and allergy-delete extend the existing pipeline cleanly. Notes require a different shape (long-form drafts, signoff state). Orders / prescriptions cross into territory where the verification model itself needs rethinking — those should not be added without a fresh design pass.

---

## Theme 3 — Verification layer extensions

Open gaps from [VERIFICATION.md](../../../VERIFICATION.md) §"What verification does NOT catch":

- **Fidelity-drift detection** — citation valid, but content paraphrased away from source. Needs a structured-extraction pass (small model or regex-shape extractor) that compares generated text against cited row values for dose / frequency / numeric fidelity. ~3–5 days; meaningful addition to verification logic, not a one-line fix.
- **Broader negative-claim coverage** — extend beyond allergies + labs to medications, conditions, immunizations, family history. Either a regex set or a small classifier. ~1 day for the regex extension; ~3 days for the classifier.
- **Drug-drug interactions** — RxNorm + DrugBank or similar. Adds latency and a non-trivial knowledge base; couples naturally with Theme 1 evidence infrastructure.
- **Pediatric vs adult vital ranges** — V1 uses adult ranges only. Extending requires patient demographics in the verification context (already available in `ClinicalToolEvidence`) plus a small lookup table. ~½ day.
- **Streaming verification** — token-level commit-or-rollback. Significant rewrite; defer until streaming UX is actually needed.

---

## Theme 4 — Workflow expansion

- **Multi-encounter context.** V1 binds to one active encounter. Cross-encounter Q&A ("show A1c trend over the last year", "did metformin compliance change after the dose increase") requires either expanded chart context per turn or a multi-turn binding model. ~1 week including binding-model design.
- **Patient-side audio capture (with explicit consent).** V1 is physician-only by design — no patient audio, no retained audio file, no ambient listening. With proper consent UX and retention policy, ambient capture during the visit unlocks transcript-driven note drafts. Couples directly with the encounter-notes write target in Theme 2.
- **Day-view briefing.** V1 renders an empty state with no chart open. A pre-day briefing across all scheduled patients requires a new bounded read scope (cross-patient calendar) outside the active-chart binding model. Architectural decision: either expand the binding model or add a separate "day-view session" with its own scope.
- **Specialist workflows.** V1 anti-persona list includes specialists, ED, pediatric, surgical, dental, mental-health-only. Each is a separate persona with different chart-context shapes; this is not a generic extension but a fork-per-specialty.

---

## Theme 5 — Operational and compliance

- **Real-PHI deployment posture.** Per [ARCHITECTURE.md](../../../ARCHITECTURE.md) Compliance-2, real-PHI deployments default back to self-hosted Langfuse. V2 formalizes the swap: documented BAA, retention policy, audit log purge schedule, breach-detection alerting. Independent of feature work but blocks any non-demo deployment.
- **Cost-rate accuracy and model rotation.** V1 punch list includes the [cost_estimate.ts](../../../agentforge/api/src/agent/cost_estimate.ts) heuristic fix. V2 should formalize a per-model pricing table sourced from a single vendor-neutral location, plus a model-rotation strategy (e.g., Haiku for tool-routing turns, Sonnet for response generation).
- **CI gate for the eval suite.** Partly on V1 punch list. V2 adds **production-trace replay** — sampled real turns re-run through the deterministic eval rules to catch model regressions in the wild.
- **Multi-region / scaling.** V1 is single VPS + Compose. V2 scaling per [ARCHITECTURE.md](../../../ARCHITECTURE.md) "Cost snapshot": managed Postgres + replicas at ~1k MAU, regional cells at higher tiers.

---

## What's intentionally NOT on this list

- **Multi-agent orchestration** ("planner agent + verifier agent + tool agent + …"). V1's verification model is deterministic, not agentic. Adding LLM-based verifiers undermines the auditability story that the four-layer pipeline gives us.
- **Autonomous writes.** The confirmed-write contract is V1's defining safety property. V2 may expand the *set* of confirmed write targets but does not relax the confirmation requirement.
- **Real-time chart-data sharing across organizations.** Out of scope and out of likely project lifetime.
- **Generic "ChatGPT for the EMR".** V1 succeeds because it is journey-shaped and narrow. A general-purpose chat over OpenEMR is an anti-goal.

---

## How to use this doc

When V2 scoping starts, treat each theme as a candidate workstream. The recommended starting point is **Theme 1 (evidence-based citation)** — high user value, clean architectural fit, manageable effort, and the most defensible "next safety layer" story for clinical reviewers.

Pick one workstream, write a real PRD with stop-the-line invariants and eval cases, and break it into gates the way V1 was broken into G0–G7. Don't treat this doc as authoritative once V2 work begins — it's a starting point, not a contract.

---

## Cross-references

- [VERIFICATION.md §7](../../../VERIFICATION.md) — the V1 limitation that triggered Theme 1.
- [USERS.md §7.1](../../../USERS.md) — V1 "does not include" list, source for Theme 2 candidates.
- [ARCHITECTURE.md](../../../ARCHITECTURE.md) — V1 architecture reference, including Compliance-2 and Cost-snapshot anchors used here.
- [clinical-copilot-task-list.md](clinical-copilot-task-list.md) — V1 task list shape; V2 PRDs should follow the same gate structure.
- [submission-checklist.md](submission-checklist.md) — V1 ship gate.
