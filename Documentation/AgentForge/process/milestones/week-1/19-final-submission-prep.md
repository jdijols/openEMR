# Final submission prep — UC, eval, CRUD, and doc-sync expansion

**Purpose:** Take the project from a 3-UC / 13-eval Stage-5 state into a portfolio-ready, instructor-defensible submission for the 2026-05-03 12:00 CT Sunday final. This milestone covers the rebrand to "Clinical Copilot" (with strategic separation of product brand from program context), the CRUD soft-delete additions for the three dictation surfaces (vitals, chief complaint, clinical notes), the eval expansion that addresses Thursday-night instructor feedback, the USERS.md restructure to 10 named use cases with documentary med-reconciliation and abnormal-lab surfacing, and the cross-doc sync that landed everything in `gitlab/master`.

## Decisions

The full pivot-by-pivot reasoning lives in the session journal: [journal/week-1/0503-T0237-submission-final-pass.md](../../journal/week-1/0503-T0237-submission-final-pass.md). One-line summaries:

- **Rebrand product/program split.** "Clinical Copilot" is the product (front-of-portfolio); "AgentForge" stays as the Gauntlet program/cohort context. Internal `agentforge/` directory and `oe-module-agentforge` PHP module names preserved to avoid disrupting the live demo. Filesystem rename deferred post-submission.
- **README narrative leads with "automation, not advice".** Sinsky 2016 *Annals of Internal Medicine* 2:1 EHR/desk-vs-face-time ratio anchors the problem statement. Non-goals are a real section, not a footnote.
- **TASKS.md promoted to root** for portfolio convention recognition + discoverability. Renamed from `Documentation/AgentForge/implementation/clinical-copilot-task-list.md` via `git mv`; 30+ cross-references in process trail + journals + implementation docs rewritten.
- **CRUD soft-delete tools added** for vitals (void erroneous row by UUID, `forms.activity = 0`) and chief complaint (clear field). End-to-end across TS tools → confirm-router → 5 PHP files → 2 HTTP routes. Mirrors the existing clinical-note-edit pattern. Pre-procedure anticoagulation check (instructor-suggested third UC) deliberately skipped — V1 has no procedure-planning workflow.
- **Eval suite 13 → 39 cases / 6 → 10 check rules.** New rules: `all_domains_unavailable_refused`, `provider_timeout_typed_error`, `conflicting_medication_records_warned`, and the killer `constraint_boundary_describes_vs_recommends` (now the most heavily covered rule at 12 cases — mechanically protects the README's "automation, not advice" promise across paraphrase variants).
- **USERS.md restructured to 10 named UCs** (UC-A through UC-J) organized by intent and CRUD operation. UC-I and UC-J are documentary cross-domain workflows (medication reconciliation, abnormal lab surfacing) — strictly data work, no advisory phrasing. Enforcement via the constraint-boundary eval rule, not in-prose disclaimers (per user's correct push: "the natural cadence of reading the agent's response as very objective will imply that already").
- **update-submission-files skill ran with 30 mechanical drift edits.** Above the skill's normal ~15 abort threshold but every finding was evidence-based and traced to this session's own work catching up (UC count drift, anchor drift from verification.ts module-docblock addition, eval count drift). Three genuine prose-rewrite items surfaced as inline `> NEW GAP` blockquotes in EVALUATION.md for post-submission manual rewrite.

## Outcomes

- 10 use cases, 39 eval cases, 2 new write tools, 0 code regressions (`npm run eval` 39/0).
- All 6 root submission docs (USERS, ARCHITECTURE, VERIFICATION, EVALUATION, OBSERVABILITY, README) lead with "Clinical Copilot" branding.
- Live URL `https://108-61-145-220.nip.io` continues to serve the Thursday-shipped demo; new soft-delete tools and UC-I/UC-J workflows are functional but not in Thursday's recorded video.
- Commit `a0d505905` landed and pushed; follow-up commit covers post-skill doc-sync edits.

## Cross-references

- Session journal (full reasoning): [journal/week-1/0503-T0237-submission-final-pass.md](../../journal/week-1/0503-T0237-submission-final-pass.md)
- Eval suite: [agentforge/api/eval/](../../../../../agentforge/api/eval/)
- New write-side PHP code: [interface/modules/custom_modules/oe-module-agentforge/src/Write/](../../../../../interface/modules/custom_modules/oe-module-agentforge/src/Write/) (VitalsDelete*, ChiefComplaintDeleteAction)
- Submission deliverables tracker: [implementation/Submission-Checklist.md](../../../implementation/Submission-Checklist.md)
- Prior milestone: [18-langfuse-observability-cost-analysis.md](18-langfuse-observability-cost-analysis.md)
