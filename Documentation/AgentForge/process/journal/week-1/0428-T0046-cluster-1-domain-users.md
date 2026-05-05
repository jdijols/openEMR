---
date: 2026-04-28
topic: Cluster 0+1 — AUDIT.md scaffold + presearch domain & users
related_milestone: process/milestones/week-1/06-stage3-audit.md
---

# Cluster 0+1 — AUDIT scaffold and domain & users — session journal

## Goal

Combine **Cluster 0** (scaffold the Stage 3 audit deliverable) with **Cluster 1** (fill the domain/users-only presearch sections) in one chat, per the cluster sequence locked in the prior session. Cluster 0 has no audit findings yet, so it does not crowd `AUDIT.md` if paired with Cluster 1's reflection-only work.

## Context

The prior session locked a 9-cluster plan that **interleaves the Stage 3 audit with the presearch checklist** rather than treating them as parallel tracks. Many presearch questions only become honest *after* the corresponding audit finding lands (e.g., framework choice depends on architecture audit findings). The case study mandates `./AUDIT.md` at repo root with a ~500-word executive summary as the hard gate. Conventions for reading the audit live in the process trail, not in the deliverable, so the gate doc stays clean.

## Key decisions

### Decision: AUDIT.md is the deliverable; conventions live in the process pointer

- **Prompt:** "Go ahead and make the skeleton for the audit.md file. All the cross-link syntax and legend ID formatting is good with me."
- **Recommendation:** Put `./AUDIT.md` at repo root with just the deliverable shape — executive-summary placeholder, five domain sections with scope statements + "to be filled in Cluster N" notes, and methodology / references appendices. Park all conventions (finding ID format, severity legend, finding template, cross-link syntax, methodology rules of thumb) in [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md). This keeps the graded hard-gate document grader-ready and the process metadata in the process trail where future-me will look for it.
- **Outcome:** [`AUDIT.md`](../../../../../AUDIT.md) and [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md) created. README trail table extended with row 6; "How to extend" pointer bumped to slot 07.

### Decision: ED / Urgent Care as v1 persona

- **Prompt:** "my initial thought is prioritizing personas where there's less risk involved and less complexity. An example would be emergency department rooms and urgent care, where there is high turnover of patients … this use case in urgent care and emergency departments is where there is the least complexity, so let's focus here first."
- **Recommendation:** Adopt ED / Urgent Care as the v1 persona; explicitly defer primary care / hospitalist iteration. Maps cleanly to read-only advisory posture: less prior-chart assumption, more "what's happening now" framing, smaller surface for hallucination, fewer cross-references to maintain.
- **Outcome:** [`03-presearch-checklist.md` §1](../../milestones/week-1/03-presearch-checklist.md) filled inline with persona, use case, verification requirements, and data-source scope (with a deferral pointer to the Architecture audit for table-level detail).

### Decision: Read-only advisory posture for v1

- **Prompt:** User chose "read-only, advisory" with explicit roadmap framing — "if this is an initial launch for this type of agent being integrated into openEMR, we should prioritize the least risky user journeys and user stories before making more high-risk operations on behalf of the agent."
- **Recommendation:** Lock as v1 HITL posture; reserve drafts-for-review and limited-writes as **future product tiers**, not v1 features. Risk posture intentionally matches the persona choice — neither piece is independent.
- **Outcome:** [`03-presearch-checklist.md` §3](../../milestones/week-1/03-presearch-checklist.md) (intent-only pass) filled inline; full security/compliance mechanics deferred to Cluster 3 with an explicit italic note in the section header.

### Decision: Open-source destination is GitLab + reserved GitHub mirror — design for public from day one

- **Prompt:** "course only, lives in Gauntlet GitLab for grading; however, I would reserve the option to post this onto my personal GitHub and share for job interviews in my portfolio … Keep that option open to me."
- **Recommendation:** Treat commits, secrets hygiene, and READMEs **as if public from day one** so the GitHub mirror option stays open without retroactive cleanup. License: GPLv3 inherits for derivative work; agent layer designed for **API-only coupling** (HTTP / FHIR) preserves the option to license that layer separately if ever extracted.
- **Outcome:** [`03-presearch-checklist.md` §14](../../milestones/week-1/03-presearch-checklist.md) (initial pass) filled inline; license detail revisited in Clusters 3 + 7.

### Decision: Combine Clusters 0 + 1 in one chat; keep Cluster 2 standalone

- **Prompt:** "Let's go ahead and do cluster 0 and cluster 1 within this same chat."
- **Recommendation:** Combining is efficient because Cluster 0 (scaffolding only) doesn't crowd `AUDIT.md` — no findings land in the same chat. Keep Cluster 2 (Architecture audit + framework / tool design) standalone because it's a much heavier exploration session that benefits from undivided attention.
- **Outcome:** Both clusters captured in this single journal; Cluster 2 cued as the next chat's session boundary.

## Trade-offs and alternatives

- **Personas not chosen:** primary care (longitudinal context, more complex), hospitalist (rounding handoffs, dense per-patient context), specialists (narrow depth, harder to evaluate in v1). All deferred until v1 is grounded.
- **HITL strengths not chosen:** drafts-for-review, limited writes, full write authority. All deferred as future product tiers.
- **AUDIT.md location:** under `Documentation/AgentForge/` was rejected — case study explicitly says `./AUDIT.md` (repo root). The `06-stage3-audit.md` pointer file bridges the trail.
- **Conventions location:** inline in `AUDIT.md` was rejected to keep the graded deliverable clean.
- **Phase-summary numbered files:** rejected in the prior session — `03-presearch-checklist.md` is the answer-book summary; only load-bearing decisions earn numbered files.

## Tools, dependencies, commands

_None this session._ No installs, no new tooling. All work was scaffolding + reflection inside the existing process trail.

## Files touched

- **Created:** `AUDIT.md`
- **Created:** `Documentation/AgentForge/process/milestones/week-1/06-stage3-audit.md`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0046-cluster-1-domain-users.md`
- **Modified:** `Documentation/AgentForge/README.md` (added trail row 6; bumped "How to extend" next-slot to 07)
- **Modified:** `Documentation/AgentForge/process/milestones/week-1/03-presearch-checklist.md` (filled §1 in full; §3 intent-only pass with deferral note; §4 in full; §14 initial pass with deferral note)

## Outcomes

- Stage 3 audit deliverable scaffolded at the case-study-mandated path (`./AUDIT.md`); five sections in place with explicit cluster-ownership notes.
- Process pointer (`06-stage3-audit.md`) holds all conventions: finding ID format, severity legend, finding template, cross-link syntax, methodology rules, cluster mapping, and a status checklist.
- README trail table coherent — row 6 added, next milestone slot is 07. No stale `docs/agentforge/` paths anywhere (hygiene check passed).
- Cluster 1 presearch answers (§1 Domain, §3 Reliability intent, §4 Team & Skill, §14 Open Source initial) filled inline with terse bullets; partial sections clearly marked with italic deferral notes pointing at the cluster that will deepen them.

## Next steps

- [ ] **Cluster 2 (next chat):** Architecture audit. Populate `AUDIT.md` §3 with first findings; methodology footprint into Appendix A; fill presearch §2.5 (framework), §2.7 (tool design), §3.15 (deployment partial). Verify the cross-link syntax holds when the first real finding lands (anchor format, relative paths from journal → AUDIT.md → presearch all resolve).
- [ ] During Cluster 2, decide whether the agent layer's HTTP/FHIR coupling assumption (made in §1.4 / §3.14) holds against OpenEMR's actual integration surfaces — if not, revisit licensing implications immediately.
- [ ] Watch for the first **load-bearing decision** that warrants its own numbered file (e.g., framework selection). Slot 07 is reserved.

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../../AUDIT.md)
- Process pointer for Stage 3: [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md)
- Presearch checklist (filled this session): [`process/milestones/week-1/03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md)
- Impressions doc (informs §1 use cases): [`process/milestones/week-1/01-agentforge-impressions.md`](../../milestones/week-1/01-agentforge-impressions.md)
- AgentForge README (trail table): [`Documentation/AgentForge/README.md`](../../../README.md)

---

## Postscript — 2026-04-28 ~01:10 (same chat, after grill-me)

After this journal was written, the user invoked the [`grill-me`](../../../../.agents/skills/grill-me/SKILL.md) skill against the Cluster 1 answers, citing the [case study scenario text](../../../references/Week%201%20-%20AgentForge.pdf). The first grilled question exposed a real coherence gap: the scenario describes an **ambulatory, returning-patient, rich-prior-chart** workflow ("between patient rooms," "what changed since the last visit," "dense EHR notes... lab results... medication lists"), which doesn't fit the **ED / Urgent Care first-encounter** persona locked in this session. After two rounds (ED → pediatric well-child → adult PCP non-emergent), the user landed on:

- **v1 persona revised to: adult primary care physician (family medicine), non-emergent visit-type scope** (annual physicals, simple acute visits like flu / earache / throat infection / uncomplicated URI, routine stable-chronic-disease follow-ups). Rationale: matches the case-study scenario directly, preserves the risk-minimization instinct via *visit-type scoping* + *read-only advisory posture* rather than *starving the agent of context*, and is the most demo-data-realistic persona for the OpenEMR fork.
- **New cluster inserted: Cluster 1.5 — Demo data persona-viability spike.** Persona is **provisional** until a read-only inspection of the demo dataset confirms longitudinal adult patients with returning visits + problem list + meds + labs + encounters. Locked into [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md) cluster mapping + status checklist.
- **Files updated:** [`process/milestones/week-1/03-presearch-checklist.md`](../../milestones/week-1/03-presearch-checklist.md) §1 (rewritten to provisional adult PCP with TBD callouts) and §3.1 (cost-of-wrong-answer mitigation now includes visit-type scoping); [`process/milestones/week-1/06-stage3-audit.md`](../../milestones/week-1/06-stage3-audit.md) (Cluster 1.5 inserted); [`AUDIT.md`](../../../../../AUDIT.md) §4 + Appendix A (note about early-spike finding from Cluster 1.5).

The original Decision entries above remain a **faithful record of what was decided in this session at the time it was written**. The persona revision is a *subsequent* decision made in the same chat; it lives here in the postscript rather than rewriting history. The next session opens with **Cluster 1.5**, not Cluster 2 — see updated cluster mapping in `06-stage3-audit.md`.
