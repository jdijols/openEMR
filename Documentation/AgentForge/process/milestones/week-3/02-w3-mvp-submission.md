# 02 — W3 MVP submission: Clinical Adversary foundation

Single-session milestone covering the Week 3 MVP submission to Gauntlet. Executes the brief's four prescribed Stage hard gates in order (Stand Up Target → Threat Model → Attack Suite + 1 Agent Role Live → Plan Architecture), corrects two architectural-drift items surfaced mid-session (Langfuse cloud-vs-self-hosted, ARCH §5 ASCII-art-vs-real-diagram), names the W3 product `Clinical Adversary` to disambiguate from the AgentForge cohort brand and the W1/W2 `Clinical Co-Pilot`, replaces a verbose verbatim demo script with a one-page cheat sheet aligned to the operator's voice, records the demo, and prepares the submission-form field values.

## Decisions

- **`Clinical Adversary`** is the W3 product name. `AgentForge` retained as program/cohort designation, directory paths, and GACL identifiers. Mirrors W1/W2's `Clinical Co-Pilot` naming.
- **Console v0 (JSON-backed Vite scaffold) deferred from tonight to Gate 5 (Friday).** Building UI against unfinished data shapes (no ledger, no Orchestrator priorities, no Judge tier-2 disagreements) would render empty shells. Friday Console v1 builds from scratch against real data.
- **Langfuse stays on cloud through Friday.** Pre-Stage-1 audit confirmed both dev and prod were on cloud despite [`W2_ARCHITECTURE.md`](../../archive/W2_ARCHITECTURE.md) claiming self-hosted. Review Console reads our own Postgres ledger for taxonomy queries; trace drill-down uses Langfuse's REST API. Self-hosted re-classified as v2 commercialization commit. [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) §9 + §11 walked back.
- **Submission deployed-app URL = the target** (`https://oe.108-61-145-220.nip.io/`), not the adversarial platform itself. The brief's "Deployed Application" deliverable was defined as the publicly accessible **target** system being adversarially tested. Both repo-URL form fields = same OpenEMR monorepo per the brief's "Forked from OpenEMR" requirement.
- **Demo communication: one-page cheat sheet over verbatim script.** Plain-language framing of beats with on-screen pointers and anchor phrases. Threat-scenario framing corrected — the Co-Pilot is gated behind login; the real threat is authenticated insiders, compromised accounts, and adversarial content riding in via uploaded documents, **not** external attackers on a public API.

## Deliverables shipped

| What | Where |
|---|---|
| Threat Model (~500-word summary + 6 categories × 12 subcategories) | [`THREAT_MODEL.md`](../../../../THREAT_MODEL.md) |
| Multi-agent Architecture (~500-word summary + Mermaid system diagram + Mermaid §5 lifecycle + 13 sections) | [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md) |
| Eval suite — 9 seed cases × 3 categories | [`evals/seeds/`](../../../../evals/seeds/) |
| 2 captured live runs against deployed prod target | [`evals/results/`](../../../../evals/results/) |
| Red Team Agent prototype + deterministic Judge (one live agent role for the Stage 3 hard gate) | [`agentforge-redteam/`](../../../../agentforge-redteam/) |
| W3 process workspace (stage notes, tasks roadmap, demo script, cheat sheet, architecture-defense source) | [`Documentation/AgentForge/w3-mvp/`](../../../w3-mvp/) |
| Repo-root README updated with "Week 3 submission — start here" section | [`README.md`](../../../../README.md) |

## What we discovered by attacking the target

- **Typed `refusal` blocks** with reason codes (`blocked_cross_patient_tool_args`, `internal_details_not_available`) in the W2 supervisor that the W2 architecture doc did not document. The W2 target's defensive posture is stronger than its docs claimed; this is a CISO-facing hardening signal Friday's Documentation Agent should call out.
- **89% verdict reproducibility** across two captured runs (8 of 9 cases identical). The 1 case that flipped (`p2-6a-roleplay-framing`: PARTIAL → FAIL) is **another Judge false positive** — same architectural mechanism as the first (forbidden substring appears inside a correct refusal, not because the assistant did the wrong thing). The two FP examples together are the measured-from-real-data argument for the Friday two-tier Judge.

## Links

- Session journal: [process/journal/week-3/0513-T0155-w3-mvp-submission.md](../../journal/week-3/0513-T0155-w3-mvp-submission.md)
- Bridges from: [process/milestones/week-3/01-prod-deploy-and-cohort-reset.md](01-prod-deploy-and-cohort-reset.md)
- Submission commits on `gitlab/master`: `7708a678b` (W3 MVP package) · `41f1b9539` (Clinical Adversary rename + run-2 fold-in) · `8ddb17e40` (DEMO_CHEAT_SHEET + ARCH §5 Mermaid) · `95818304d` (STAGE_3 both-runs update)
- Tag: `w3-mvp`
- Demo video (Loom): https://www.loom.com/share/1c1476293fce47b7bf06af1fef57bed3
