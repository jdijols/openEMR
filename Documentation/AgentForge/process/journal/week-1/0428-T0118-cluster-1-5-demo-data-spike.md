---
date: 2026-04-28
topic: Cluster 1.5 — Demo data persona-viability spike
related_milestone: process/milestones/week-1/06-stage3-audit.md
---

# Cluster 1.5 — Demo data persona-viability spike — session journal

## Goal

Answer one question with evidence: **does the OpenEMR bundled demo dataset support the v1 persona** locked provisionally in Cluster 1 (adult PCP, non-emergent visit-type scope, returning patients with rich charts) — or does the persona need to revise before any architecture, verification, or eval work is locked?

## Context

The prior session ([0428-T0046](0428-T0046-cluster-1-domain-users.md)) closed Cluster 1 with a **provisional** v1 persona after a `grill-me` round flipped the original ED/UC choice to adult PCP. The persona was locked *provisionally* because persona shape is load-bearing for every downstream cluster (architecture audit scope, verification claim categories, eval ground truth). Cluster 1.5 was inserted into the cluster map specifically to confirm the bundled demo dataset can carry the persona before the heavier audits start, since discovering misalignment after Cluster 2 costs much more than spending one focused chat on the data first.

## Key decisions

### Decision: Persona target **locked**; demo dataset insufficient; data augmentation becomes a Cluster 4 prerequisite

- **Prompt:** "Cluster 1.5 — Demo data persona-viability spike. ... does the OpenEMR demo dataset actually support that persona, or does it need to revise?"
- **Recommendation:** Lock the persona target as written (adult PCP, non-emergent, returning patients with rich charts). The persona itself is the right product target — it maps directly to the case study scenario. **The bundled demo dataset is what's broken**, not the persona. Add a **hard prerequisite gate** to presearch §1: data augmentation (leading candidate Synthea, already cued and deferred in the Stage 1 runbook) must precede Cluster 4 (Verification + Eval) and Cluster 6 (demo). Hand-curated vs Synthea vs hybrid decision deferred to Cluster 4 where it belongs.
- **Outcome:** [`AUDIT.md` §DataQuality-1](../../../../../AUDIT.md#dataquality-1-persona-viability--adult-pcp-returning-patient-demo-coverage) landed (severity High); [`03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md) §1 rewritten — provisional callouts removed, persona locked, Cluster 1.5 outcome bullet inserted, data-source bullet updated to reflect what the bundled demo actually does and does not contain; [`06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md) cluster map updated (Cluster 1 → Done, Cluster 1.5 → Done, status checkbox ticked).

### Decision: Skip the UI Finder click-through — DB result already unsatisfiable

- **Prompt:** Methodology step 3 — "pick 2–3 multi-visit candidate patients via the Finder, read their last two visits each, confirm a meaningful 'what changed since last visit' signal exists."
- **Recommendation:** The DB-level result (3 patients, 1 encounter each, all 2014-02-01) makes "multi-visit candidate" the empty set. Doing the Finder click-through to confirm that the empty set is empty would be theatre, not evidence. Document the decision in Appendix A and move on. Stay tight per the spike's "one-question" framing — full §4 happens in Cluster 4.
- **Outcome:** [`AUDIT.md` Appendix A](../../../../../AUDIT.md) Data Quality bullet explicitly notes the UI step was skipped and why. The methodology footprint is honest about what was and was not done.

## Trade-offs and alternatives

- **REVISE the persona instead of LOCK** — rejected. The persona target is correct; the case study scenario was the constraint, and the persona maps to it. Revising would either drop "returning patient with rich chart" (contradicts case study) or revert to ED/UC (rejected last session via grill-me). The honest framing is: persona is locked, dataset is the problem.
- **Decide Synthea vs hand-curated *now*** — rejected. That decision belongs in Cluster 4 (Data Quality + Verification + Eval) where it can be made with full architecture context from Cluster 2 and clarity on how the eval harness will consume the data. Cluster 1.5 is a *spike*, not a data-strategy decision session.
- **Lower severity to Medium** — rejected. The bundled demo cannot support *any* of the case study scenario's three substrate requirements (multi-visit history, lab trends, meaningful narratives). It blocks the demo and eval entirely until augmented. That is a material gap that constrains design — High per §06-stage3-audit §2.2 severity legend.
- **Run UI sanity check anyway** — rejected as theatre (see decision above).
- **Dump every empty table in the evidence list** — rejected. The finding's evidence stays focused on tables the persona depends on (encounters, labs, narratives, problem/med lists, immunizations, prescriptions, calendar). Exhaustive enumeration belongs in the full Cluster 4 audit.

## Tools, dependencies, commands

All read-only inspection — no installs, no schema changes, no demo-data reload.

```bash
# Stack already running (verified via docker compose ps)
cd /Users/jasondijols/Documents/Code-Projects/openEMR/docker/development-easy

# Representative query (full evidence chain in AUDIT.md §DataQuality-1)
docker compose exec -T openemr mysql -h mysql -u openemr -popenemr openemr \
  -e "SELECT pid, COUNT(*) AS n, MIN(date) AS first, MAX(date) AS last \
      FROM form_encounter GROUP BY pid;"
```

Tables inspected: `patient_data`, `form_encounter`, `form_soap`, `form_vitals`, `forms`, `lists`, `prescriptions`, `procedure_order`, `procedure_report`, `procedure_result`, `immunizations`, `form_clinical_notes`, `form_ros`, `form_history_sdoh`, `history_data`, `pnotes`, `documents`, `transactions`, `openemr_postcalendar_events`, `openemr_postcalendar_categories`, `users`, `information_schema.tables`.

## Files touched

- **Modified:** `AUDIT.md` (added `DataQuality-1` finding; replaced placeholder note in §4; expanded Appendix A § Data Quality to reflect spike methodology and the skipped UI step).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/03-presearch-checklist.md` (§1 rewritten — provisional pass header replaced with locked-target header; persona bullets stripped of "(provisional)" and TBD callouts; Cluster 1.5 outcome bullet added; data-source bullet updated with concrete demo coverage).
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/06-stage3-audit.md` (cluster mapping: Cluster 1 status → Done, Cluster 1.5 status → Done; status checklist box for Cluster 1.5 ticked with one-line summary).
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0118-cluster-1-5-demo-data-spike.md` (this file).

## Outcomes

- **Question answered with evidence:** the bundled `dev-reset-install-demodata` dataset does **not** support the v1 persona. 3 patients, 1 encounter each, all 2014-02-01; placeholder SOAP narratives ("Amputate toe", "abx"); zero labs at any layer; zero immunizations; zero modern clinical-notes content; ICD9-coded problems; 0 patients meet the ≥2-visits threshold the persona requires.
- **Persona target locked** unchanged (adult PCP non-emergent, returning patients with rich charts). The cost-of-change downstream of this lock is now bounded — Cluster 2 architecture work proceeds against a stable persona shape.
- **New gate added to presearch §1:** data augmentation is a hard prerequisite before Cluster 4 / Cluster 6. Synthea is the leading candidate; final decision deferred to Cluster 4 where it can be made against the eval-harness shape.
- **Cluster sequence preserved.** Next chat is **Cluster 2 — Architecture audit**, exactly as the cluster map intended before the persona-viability uncertainty was inserted.

## Open thread (preserved, not addressed this session)

The prior `grill-me` exposed several questions that still need answering and were intentionally deferred until evidence catches up:

- Conversation-vs-cards interface shape (Cluster 2 / Cluster 6).
- Authorization read-permission scoping — physician vs nurse vs resident (Cluster 3 Security).
- Speed-vs-completeness tradeoff direction (Cluster 5 Performance + Cluster 6 demo).
- Demo-data + BAA acknowledgment in §3 (Cluster 3 Compliance).
- Verification claim-category enumeration — meds, allergies, lab trend, "since last visit", negation claims (Cluster 4 Data Quality + Verification).
- Graceful-degradation acknowledgment in §1 + §11 (Cluster 4 / Cluster 6).

Most of these depend on Cluster 2 architecture context or Cluster 4 data shape — neither of which existed at grill time. Resume the grill thread once those evidence points are in hand.

## Next steps

- [ ] **Cluster 2 (next chat):** Architecture audit. Populate `AUDIT.md` §3 with first findings; methodology footprint into Appendix A; fill presearch §2.5 (framework), §2.7 (tool design), §3.15 (deployment partial). First real cross-link from `AUDIT.md` to presearch under load — verify the anchor format produced by `DataQuality-1` resolves correctly when followed.
- [ ] During Cluster 4: pick up the **Synthea vs hand-curated vs hybrid** decision now gated by `DataQuality-1`. Evaluate against the eval-harness shape locked in the same cluster.
- [ ] If anything in Cluster 2 reveals that the agent's HTTP/FHIR-only coupling assumption from §1.4 / §3.14 doesn't hold, revisit licensing implications immediately.

## Links

- Hard-gate finding: [`AUDIT.md` §DataQuality-1](../../../../../AUDIT.md#dataquality-1-persona-viability--adult-pcp-returning-patient-demo-coverage)
- Process pointer for Stage 3: [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md)
- Presearch checklist (§1 updated this session): [`process/milestones/week-1/03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md)
- Stage 1 runbook (Synthea cue at "Not in scope for Stage 1"): [`process/milestones/week-1/04-stage1-local-dev-runbook.md`](../../milestones/week-1/04-stage1-local-dev-runbook.md)
- Prior session that locked the provisional persona: [`0428-T0046-cluster-1-domain-users.md`](0428-T0046-cluster-1-domain-users.md)
