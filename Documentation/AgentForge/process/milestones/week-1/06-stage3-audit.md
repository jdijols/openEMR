# Stage 3 — audit (process pointer)

**Purpose:** Index entry for the **Gauntlet AgentForge Stage 3 hard-gate deliverable** at [`./AUDIT.md`](../../../../../AUDIT.md). Stage 3 mandates a full audit of the existing system across **five domains** before any new agent code is written. This file is the **process trail's** pointer at that deliverable: it captures methodology, conventions, and the cluster sequence that produces the findings, so the AUDIT.md document itself can stay clean and grader-ready.

**Status:** Complete; Cluster 8 finalized the executive summary and cross-link/status sweep, then a **parallel-audit synthesis pass** (2026-04-28) cross-referenced the cluster-driven audit with an independent second-pass audit by another agent and merged both into the canonical [`AUDIT.md`](../../../../../AUDIT.md). The two pre-merge originals are preserved under [`./archive/`](../../archive/) for traceability — see §6 below.

---

## 1. Required scope (from the case study)

The Stage 3 brief mandates audits across five domains, each with its own emphasis:

1. **Security** — authentication and authorization risks, data exposure vectors, PHI handling issues, HIPAA-relevant gaps.
2. **Performance** — bottlenecks, data structure, constraints affecting agent response latency.
3. **Architecture** — system organization, data layout, layer interactions, integration points for new capabilities.
4. **Data Quality** — completeness, consistency, reliability; missing fields, inconsistent formatting, duplicates, stale records (all become agent failure modes).
5. **Compliance & Regulatory** — audit logging, retention, breach notification, BAA implications when PHI touches an LLM provider.

**Hard gate:** [`./AUDIT.md`](../../../../../AUDIT.md) at repo root, opening with a ~500-word executive summary that **highlights the most impactful findings** rather than enumerating everything.

---

## 2. Conventions (how to read AUDIT.md)

These conventions live here, not in `AUDIT.md`, so the deliverable stays a clean findings document.

### 2.1 Finding ID format

`<Category>-<n>`, where:

- **Category** ∈ { `Security`, `Performance`, `Architecture`, `DataQuality`, `Compliance` }.
- **n** is a 1-indexed integer, unique within the category. Once assigned, an ID does not change (so cross-references stay valid).

Examples: `Security-1`, `Architecture-3`, `DataQuality-2`.

### 2.2 Severity legend

| Severity | Meaning |
| --- | --- |
| **Critical** | Active risk to PHI, patient safety, or compliance posture. Must be addressed before the agent touches production data, even in demo. |
| **High** | Material gap that constrains agent design (e.g., missing authorization surface, unreliable data field) or fails a HIPAA expectation. Address before Stage 4 build. |
| **Medium** | Notable risk or limitation that shapes design choices. Document mitigation; address opportunistically. |
| **Low** | Hygiene issue with bounded blast radius. Track but do not block on. |
| **Informational** | Observation worth recording (e.g., undocumented behavior) that is neither a risk nor a constraint by itself. |

### 2.3 Finding template

Every finding under §1–§5 of `AUDIT.md` follows this shape:

```markdown
### <Category>-<n>: <Short title>

- **Severity:** Critical | High | Medium | Low | Informational
- **Description:** What the finding is, in plain language. 1–3 sentences.
- **Evidence:** Concrete pointers — `file:line`, command output, screenshot path, schema table. Multiple bullets if needed.
- **Implications for the agent:** How this finding constrains, informs, or blocks AgentForge design. 1–3 sentences.
- **Mitigation / next step:** What to do about it (or "accept and document" if no action). One sentence.
- **Related:** Cross-links to other findings, presearch §, or journals. Optional.
```

The **Implications for the agent** field is the bridge between AUDIT.md (backward-looking) and the presearch checklist (forward-looking).

### 2.4 Cross-link syntax

- **From `AUDIT.md` → presearch:** `→ presearch §<section>` (e.g., `→ presearch §3.12`).
- **From presearch → `AUDIT.md`:** `→ AUDIT.md §<finding-id>` (e.g., `→ AUDIT.md §Security-2`).
- **From journals → `AUDIT.md`:** repo-relative path `../../../../AUDIT.md#<finding-id-anchor>`.
- **From `AUDIT.md` → journals:** repo-relative path `Documentation/AgentForge/process/journal/week-N/<file>.md`.

---

## 3. Cluster mapping (which cluster fills which AUDIT section)

The audit is produced over multiple working sessions ("clusters"), each pairing one audit domain with the presearch questions it unlocks. See [`03-presearch-checklist.md`](03-presearch-checklist.md) for the presearch side of each cluster.

| Cluster | AUDIT section(s) populated | Presearch sections informed | Status |
| --- | --- | --- | --- |
| **0** | (scaffolding) | — | Done |
| **1** | — | 1.1, 1.3 (intent), 1.4, 3.14 (initial) | Done |
| **1.5** | §4 Data Quality (one early finding: persona viability) | 1.1 (lock or revise persona) | Done |
| **2** | §3 Architecture | 2.5, 2.7, 3.15 (partial) | Done |
| **3** | §1 Security, §5 Compliance | 1.3 (rest), 3.12, 3.14 (refine), 3.15 (partial) | Done |
| **4** | §4 Data Quality (full) | 2.9, 2.10 | Done |
| **5** | §2 Performance | 1.2, 2.6, 2.8 | Done |
| **6** | (synthesizes prior findings; no new audit content) | 3.11, 3.13 | Done |
| **7** | (light: log retention, monitoring infra) | 3.15 (finalize), 3.16, 3.14 (finalize) | Done |
| **8** | Executive summary + cross-link sweep | — | Done |

**Cluster 1.5 — Demo data persona-viability spike (inserted 2026-04-28).** A targeted, read-only inspection of the OpenEMR demo dataset to confirm whether the v1 persona locked provisionally in Cluster 1 (adult PCP, non-emergent visit types, returning patients with rich charts) is buildable on the demo data as currently loaded. **Output:** one early finding under `AUDIT.md` §4 (`DataQuality-1: Persona viability — adult PCP returning-patient demo coverage`) plus persona lock-or-revise in [`03-presearch-checklist.md`](03-presearch-checklist.md) §1. **Why early:** persona shape is load-bearing for everything downstream (architecture audit scope, verification design, eval ground truth). Discovering misalignment after Cluster 2 or later costs much more than spending one focused chat on the data first. The full Data Quality audit later landed in **Cluster 4** after Architecture context was available.

When a cluster lands, update the **Status** column here and the corresponding `_None yet — to be filled in Cluster N._` note in `AUDIT.md`.

---

## 4. Methodology rules of thumb

These apply across all five audit domains:

- **Cite, don't paraphrase.** Every finding's `Evidence` bullet should point at a real file, line range, command output, or screenshot. If a claim cannot be cited, downgrade it from "finding" to "observation" or do not include it.
- **Severity is about blast radius, not effort.** A trivially fixable issue can still be Critical if it would breach PHI; a hard refactor can be Low if the worst case is bounded.
- **One finding per distinct issue.** Resist composite findings ("auth has many problems"). Split them so each gets its own ID, severity, and mitigation.
- **The "Implications for the agent" field is mandatory.** If a finding has no implication for AgentForge design, it probably belongs in an upstream OpenEMR issue, not in this audit.
- **Demo data caveats.** Where a finding depends on the shape of curated demo data (rather than a guarantee about real charts), say so explicitly in the Description so the reader can weigh it.

---

## 5. Status

- [x] AUDIT.md skeleton created at repo root with five sections, severity legend reference, and executive-summary placeholder.
- [x] This pointer file linked from the README trail table.
- [x] **Cluster 1.5 — Demo data persona-viability spike** — `DataQuality-1` landed; v1 persona target locked; data-augmentation gate added to presearch §1.
- [x] **Cluster 2 — Architecture findings** — `Architecture-1` through `Architecture-4` landed; presearch §5, §7, and partial §15 updated with the module/API integration direction.
- [x] **Cluster 3 — Security + Compliance findings** — `Security-1` through `Security-4` and `Compliance-1` through `Compliance-4` landed; presearch §3, §12, §14, and §15 updated with auth/session, OAuth/ACL, PHI logging, retention, breach-response, BAA, and GPL constraints.
- [x] **Cluster 4 — Data Quality + Verification + Eval findings** — `DataQuality-2` through `DataQuality-5` landed; presearch §7, §9, and §10 updated with chart-source failure modes, hybrid Synthea + curated augmentation, source-attributed claim categories, and eval ground-truth constraints.
- [x] **Cluster 5 — Performance findings** — `Performance-1` through `Performance-5` landed; presearch §2, §6, §7, and §8 updated with chart-read latency risks, REST/FHIR vs internal service trade-offs, context-window constraints, and PHI-safe observability requirements.
- [x] **Cluster 6 — Failure Mode + Testing synthesis** — presearch §11 and §13 filled from existing Security, Architecture, Data Quality, Compliance, and Performance findings; §7/§8 lightly sharpened for degradation contracts and regression metrics without adding new audit-domain findings.
- [x] **Cluster 7 — Deployment/Operations + Iteration Planning close-out** — presearch §14, §15, and §16 finalized with release posture, GPLv3 module implications, synthetic/demo-data boundaries, real-PHI blockers, PHI-safe monitoring/alerting, rollback/disable strategy, eval-driven iteration, and long-term maintenance constraints.
- [x] **Cluster 8 — Executive Summary + cross-link/status sweep** — `AUDIT.md` status marked complete; executive summary written under 500 words; Stage 3 open threads preserved for Stage 4/5 rather than resolved without implementation or measurement evidence.
- [x] **Parallel-audit synthesis (2026-04-28)** — Cursor-led cluster audit and an independent Claude (Opus 4.7) second-pass audit cross-referenced; new findings from the second pass (PHI-plaintext columns, CORS reflection bug, `forCore` cookie HttpOnly override, dispatch.php exception leak, zero foreign keys, sparse `log` indexes, ID-system multiplicity, no outbound egress controls, log tamper-evidence gaps) merged into the canonical [`AUDIT.md`](../../../../../AUDIT.md) under `Severity/Evidence/Implications/Mitigation` format. Pre-merge originals archived (see §6).

---

## 6. Archive — pre-merge audits

The canonical [`AUDIT.md`](../../../../../AUDIT.md) at the repo root is the result of a **parallel-audit synthesis** that cross-references two independent audits of the same OpenEMR fork. Both pre-merge originals are preserved here for traceability and grader-defensibility:

| File | Author | Approach | Strengths preserved in `AUDIT.md` |
| --- | --- | --- | --- |
| [`archive/audit1.md`](../../archive/audit1.md) | Cursor (cluster-driven, Clusters 1–8) | Highly structured `Severity/Evidence/Implications/Mitigation/Related` finding format with cross-references to presearch §X and journal entries. AgentForge-specific framing ("this audit does not authorize…"). | Per-finding format, evidence chain, FHIR patient-context vs staff-ACL split (Security-2/3), demo-data quantification (DataQuality-1), hybrid Synthea+curated augmentation (DataQuality-5), modules+events integration path (Architecture-4), GPLv3 release-shape (Compliance-4). |
| [`archive/audit2.md`](../../archive/audit2.md) | Claude (Opus 4.7), independent second pass | Narrative prose with concrete `file:line` citations and a top-level Recommendations section. Spotted concrete code-level issues missed by the cluster pass. | Accessible executive-summary opener; concrete file:line evidence (CORS reflection at `CORSListener.php:57`, `forCore` HttpOnly override at line 88, `apis/dispatch.php` exception leak); zero-foreign-keys observation; N+1 grep across `src/Services/`; ID-system multiplicity; no outbound egress controls; log tamper-evidence gaps; BAA provider candidates. |

The merge process (with file:line verification of every audit2 claim before incorporation) is recorded in the dated journal entry at [`journal/week-1/0428-T1210-audit-canonical-merge.md`](../../journal/week-1/0428-T1210-audit-canonical-merge.md). The current canonical [`AUDIT.md`](../../../../../AUDIT.md) supersedes both archived originals; do not edit the archived files.

---

## Links

- Hard-gate deliverable: [`AUDIT.md`](../../../../../AUDIT.md)
- Pre-merge originals: [`archive/audit1.md`](../../archive/audit1.md), [`archive/audit2.md`](../../archive/audit2.md)
- Forward-looking checklist: [`03-presearch-checklist.md`](03-presearch-checklist.md)
- Journals: [`journal/`](../../journal/)
