---
date: 2026-05-13
topic: W3 MVP submission — Clinical Adversary foundation (stages 1-4, ARCH walk-back, demo, submission)
related_milestone: process/milestones/week-3/02-w3-mvp-submission.md
---

# W3 MVP submission — Clinical Adversary foundation — session journal

## Goal

Land the Week 3 MVP submission to Gauntlet. Cover the four brief-prescribed Stage hard gates (target stand-up · threat model · attack suite + live agent role · architecture), correct architectural drift discovered during the work (Langfuse cloud-vs-self-hosted, ARCH §5 ASCII vs real diagram), name the W3 product (`Clinical Adversary`), produce a recording artifact aligned with the user's voice (cheat sheet over verbatim script), record the demo, and submit before the 23:59 CT Tuesday deadline.

## Context

Bridges from [`process/milestones/week-3/01-prod-deploy-and-cohort-reset.md`](../../milestones/week-3/01-prod-deploy-and-cohort-reset.md) (W2 close-out + 5/11 prod redeploy) into the Week 3 cohort week proper. The W2 Clinical Co-Pilot remained the live target; W3 work was the **adversarial platform on top**, structured as a monorepo addition (`agentforge-redteam/` + `evals/` + new repo-root docs) per the brief's "Forked from OpenEMR" requirement.

Session ran ~7 hours across pre-defense, four Stage executions, several architectural corrections, the demo-script collapse-and-rebuild, and submission-form interpretation.

## Key decisions

### Decision: Four MVP stages executed in brief-prescribed order

- **Prompt:** "OK, now that you have full context and we've discussed a lot of this, let's actually initiate stage one and work all the way to the final stage by the end of this chat, which results in that architecture.md file. Stage one now."
- **Recommendation:** Follow the brief's recommended sequence strictly (Stand Up Target → Threat Model → Attack Suite + 1 Agent Role Live → Plan Architecture). Each stage produces its named deliverable; running stages serially means each output informs the next. No Console v0 build in scope tonight (see separate decision below).
- **Outcome:** Stages 1 (no target changes required — already deployed); Stage 2 → [`THREAT_MODEL.md`](../../../../../THREAT_MODEL.md) (~500-word summary + 6 categories × 12 subcategories mapped to OWASP/ATLAS); Stage 3 → 9 seed cases × 3 categories at [`evals/seeds/`](../../../../../evals/seeds/) + [`agentforge-redteam/`](../../../../../agentforge-redteam/) Red Team Agent prototype + first live run committed at [`evals/results/run-2026-05-12T23-15-12-514Z.json`](../../../../../evals/results/run-2026-05-12T23-15-12-514Z.json); Stage 4 → [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) (~500-word summary + four-agent roster + Mermaid system diagram + cost posture table + 13 numbered sections). Committed as `7708a678b` and tagged `w3-mvp`.

### Decision: Langfuse — stay on cloud through Friday, walk back the ARCH self-hosted claim

- **Prompt:** "Looks good so far on the point that you brought up on Langfuse dev environment being on the cloud. I initially believe that we should still transition to the self-hosted one. Make an analysis of the pros and cons between the two options, and if we have enough time for our Friday submission deadline to execute this, or if it would introduce more problems than solutions it would solve."
- **Recommendation:** Stay on cloud. Pre-Stage-1 audit of `secrets.{dev,prod}.env` confirmed **both** dev and prod use `https://us.cloud.langfuse.com` despite [`W2_ARCHITECTURE.md`](../../../archive/W2_ARCHITECTURE.md) claiming self-hosted. The Review Console's failure-taxonomy queries read from our own Postgres ledger (findings/verdicts/lifecycle/subcategories), not from Langfuse trace storage; trace-pair drill-down uses Langfuse's REST API on demand. Migrating mid-week buys no Friday-shippable feature and adds risk. Self-hosted re-classified as a v2 commercialization commitment.
- **Outcome:** [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) §9 + §11 footnote rewritten (`7708a678b` follow-up at end of session). README W3 section unchanged (doesn't make a self-hosted claim). [`W2_ARCHITECTURE.md`](../../../archive/W2_ARCHITECTURE.md) left as-is since it's now in archive.

### Decision: Console v0 deferred from tonight to Gate 5 (Friday)

- **Prompt:** "If you feel that it's a better path to not ship the V0 Vite React bundle, then I'm okay with that as well. I just need to know what I'm presenting in my demo video tonight that satisfies the requirements they're asking for MVP."
- **Recommendation:** Skip Console v0 tonight. Built against unfinished data shapes (no Postgres ledger, no Orchestrator priorities, no Judge tier-2 disagreements), the UI would render mostly empty shells — vaporware-shaped demo artifact that weakens the CISO-defense story the brief explicitly asks us to build to. Friday Console v1 builds from scratch against real Orchestrator data and real findings; the work compounds instead of splits. The MVP gate's four Stage hard gates are met without a deployed UI; the brief's "Deployed Application" is the **target** (Clinical Co-Pilot at `oe.108-61-145-220.nip.io`), not the adversarial platform itself.
- **Outcome:** Gate 0 in [`W3_TASKS.md`](../../../w3-mvp/W3_TASKS.md) reshaped to drop Console v0 build rows (G0-02..G0-07 in the earlier draft) and add the actual tonight work (README polish, demo script doc, demo recording). Gate 5 annotated: "Console v1 builds from scratch on Friday against the real ledger." Strategic-decision callout added near top of Gate 0 explaining the deferral.

### Decision: Product name "Clinical Adversary" (parallel to W1/W2 "Clinical Co-Pilot")

- **Prompt:** "I'm just going to read the project brief myself ... that name [AgentForge] is so amorphous to me at this point" → later → "Go ahead and call it 'Clinical Adversary' - update affected docs and push"
- **Recommendation:** Name the W3 product explicitly. "AgentForge" is the Gauntlet AI cohort/program designation (kept for directory paths, GACL identifiers, doc-folder naming). "Clinical Adversary" is the product — parallel to W1/W2's "Clinical Co-Pilot." Disambiguates in user-facing copy without renaming directories or GACL keys.
- **Outcome:** Renamed across [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) (title + diagram subgraph), [`README.md`](../../../../../README.md) W3 section, [`agentforge-redteam/README.md`](../../../../../agentforge-redteam/README.md) (title + intro), and [`Documentation/AgentForge/w3-mvp/MVP_DEMO_SCRIPT.md`](../../../w3-mvp/MVP_DEMO_SCRIPT.md) Beat 1. "Naming note" callout added in ARCH and the agentforge-redteam README so a grader landing on any single doc immediately understands the program/product split. Committed as `41f1b9539`.

### Decision: Demo communication shape — cheat sheet over verbatim script; corrected threat-scenario framing

- **Prompt:** "Your intro says that the system talks to the assistant the same way an outside attacker would, by sending messages to a public API, and that there's no inside access. That's the complete opposite of how I understood it. ... It's private, gated with the password."
- **Recommendation:** Two problems: (1) the verbatim script was technical-language-heavy and didn't match the user's voice; (2) the original opener framed the threat as **external attacker / public API** when the Co-Pilot is **gated behind login** — the real threat is authenticated insiders, compromised accounts, and adversarial content riding in via uploaded documents. Replace the verbatim-script approach with a one-page cheat sheet: six beats, each with "what to convey" (one sentence), "what's on screen" (one line), and 2–3 anchor phrases. Correct the threat framing to authenticated-user-and-uploaded-content scenario.
- **Outcome:** [`DEMO_CHEAT_SHEET.md`](../../../w3-mvp/DEMO_CHEAT_SHEET.md) created with the corrected framing at the top. Long-form [`MVP_DEMO_SCRIPT.md`](../../../w3-mvp/MVP_DEMO_SCRIPT.md) preserved as underlying reference but now points to cheat sheet from its header. User recorded against the cheat sheet (Loom: `https://www.loom.com/share/1c1476293fce47b7bf06af1fef57bed3`).

### Decision: ARCH §5 ASCII flow → real Mermaid lifecycle diagram

- **Prompt:** "Where is this ARCH document you keep referencing that has a life cycle diagram? Are you hallucinating here? Cause I don't see anything that looks like that."
- **Recommendation:** Verify before describing. ARCH §5 *did* contain a lifecycle "flow" — but it was ASCII art in a code block, not a rendered visual diagram. Calling it a "diagram" was sloppy. Convert to a real Mermaid `flowchart TD` with amber boxes for HITL gates, blue for auto-transitions, green for the terminal state, and a dashed regression-reopen arrow. The two ongoing HITL gates (#1 trace labeling, #5 re-calibration) called out below the diagram since they don't sit on the linear path.
- **Outcome:** [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) §5 updated; renders as a real Mermaid diagram on GitLab. Now a pointable artifact for Beat 5 of the cheat sheet. Committed as `8ddb17e40` alongside [`DEMO_CHEAT_SHEET.md`](../../../w3-mvp/DEMO_CHEAT_SHEET.md).

### Decision: Stage 3 notes refreshed to cover both captured runs (89% reproducibility finding)

- **Prompt:** "Also, can we update the Stage 3 run notes to reflect what the findings show between both of those runs, not just the first one?"
- **Recommendation:** Update [`STAGE_3_RUN_NOTES.md`](../../../w3-mvp/STAGE_3_RUN_NOTES.md) with a side-by-side run-comparison table. The two captured runs (5/12 23:15 and 5/13 04:20) produced 8-of-9 identical verdicts; the 1 case that flipped (`p2-6a-roleplay-framing`: PARTIAL → FAIL) is another judge false positive caused by target response-language variation tripping the regex on the word "tabloid." That 89% verdict-reproducibility figure is the **measured-from-real-data argument** for the Friday two-tier Judge architecture decision (deterministic Judge is reproducible by construction; verdict drift comes from target-side LLM variation, which an LLM Judge reading intent neutralizes).
- **Outcome:** [`STAGE_3_RUN_NOTES.md`](../../../w3-mvp/STAGE_3_RUN_NOTES.md) updated with run-comparison table, case-by-case verdict diff, two FP examples (Marcus Hill + tabloid) with verbatim refusal quotes, new Finding 5 on reproducibility. Committed as `95818304d`.

## Trade-offs and alternatives

- **Console v0 (Vite/React, JSON-backed) tonight** — considered (and initially planned in the early Gate 0 draft). Rejected after user-driven strategic review: would render empty shells for the features that don't exist yet; Friday rebuild cost was overstated as "30% throwaway" when the actual story-it-tells would be wrong (vaporware-shaped). Friday Console v1 builds from scratch against real data.
- **Self-hosted Langfuse migration before Friday** — considered after the dev/prod cloud-drift discovery. Rejected: 4–8 hours of mid-week migration risk buys no Friday-shippable feature; Review Console queries read our Postgres ledger (which we control), not Langfuse trace storage. Self-hosted is a v2 commercialization commit.
- **Long-form verbatim demo script** — initially produced (full beat-by-beat narration in [`MVP_DEMO_SCRIPT.md`](../../../w3-mvp/MVP_DEMO_SCRIPT.md)). Rejected as recording artifact after user feedback: too much jargon, didn't match his voice. Kept as written reference; cheat sheet replaces it as the recording-time artifact.
- **Live attack run during the demo recording** — recommended initially for authenticity. User flagged uncertainty about analyzing live results on camera. Cheat sheet now recommends walking through the two **already-captured** run JSONs (which are committed and verifiable) instead — same evidence, zero recording risk, and the run-to-run comparison is itself part of the story.

## Tools, dependencies, commands

- **`prek` installed via Homebrew** (`brew install prek` — version 0.3.13). Pre-commit hook runner replacing the unconfigured `pre-commit` workflow on the dev machine. Used during MVP commit prep to confirm `trim trailing whitespace`, `end of files`, `check-added-large-files`, `check json`, `pretty format json`, `mixed line ending`, `codespell` hooks all green before pushing. Tracked in [02-tooling-and-skills.md changelog](../../milestones/week-1/02-tooling-and-skills.md#changelog).
- `.codespell-ignore-words.txt` extended with `obstable` (W2 ObsTable abbreviation) and `unparseable` (valid US spelling) to silence W2 archive content false positives.
- `.pre-commit-config.yaml` exclude pattern extended to allow `Documentation/AgentForge/references/*.pdf` past the default 500 KB limit (instructor PDFs).
- Live attack-run commands captured in [`DEMO_CHEAT_SHEET.md`](../../../w3-mvp/DEMO_CHEAT_SHEET.md) (env vars + `npx tsx src/run.ts`).
- Tag `w3-mvp` created at the MVP submission commit and pushed to `gitlab/`. (GitHub `origin` push deferred until final session bundle — see Next steps.)

## Files touched

**Created (W3 MVP submission package):**
- [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) — repo root
- [`THREAT_MODEL.md`](../../../../../THREAT_MODEL.md) — repo root
- [`agentforge-redteam/`](../../../../../agentforge-redteam/) — entire dir (`README.md`, `package.json`, `tsconfig.json`, `src/{eval_schema,judge,probe,red_team_agent,run,target_client}.ts`)
- [`evals/`](../../../../../evals/) — entire dir (`README.md`, 9 seed JSONs, 2 captured run JSONs)
- [`Documentation/AgentForge/w3-mvp/`](../../../w3-mvp/) — `STAGE_1_TARGET_STATE.md`, `STAGE_3_RUN_NOTES.md`, `W3_TASKS.md`, `MVP_DEMO_SCRIPT.md`, `DEMO_CHEAT_SHEET.md`, `STAGE_0_ARCH-DEFENSE.md` (renamed from prior location)
- [`Documentation/AgentForge/references/error_analysis_slides.pdf`](../../../references/error_analysis_slides.pdf)

**Modified:**
- [`README.md`](../../../../../README.md) — added "Week 3 submission — start here" section above the W2 block
- [`.codespell-ignore-words.txt`](../../../../../.codespell-ignore-words.txt) — appended `obstable` + `unparseable`
- [`.pre-commit-config.yaml`](../../../../../.pre-commit-config.yaml) — added AgentForge references PDF exclusion
- Multiple in-session rewrites of [`ARCHITECTURE.md`](../../../../../ARCHITECTURE.md) (§5 Mermaid · §9/§11 Langfuse walk-back · title + diagram label for "Clinical Adversary" rename), [`agentforge-redteam/README.md`](../../../../../agentforge-redteam/README.md) (rename + dead-link fix), [`evals/README.md`](../../../../../evals/README.md) (dead-link fix), and [`Documentation/AgentForge/w3-mvp/MVP_DEMO_SCRIPT.md`](../../../w3-mvp/MVP_DEMO_SCRIPT.md) (rename + plain-language pass + cheat-sheet pointer).

**Renamed (via `git mv`-detected):**
- `W1_ARCHITECTURE.md` → `Documentation/AgentForge/archive/W1_ARCHITECTURE.md`
- `W2_ARCHITECTURE.md` → `Documentation/AgentForge/archive/W2_ARCHITECTURE.md`
- `Documentation/AgentForge/implementation/W3_Architecture-Defense.md` → `Documentation/AgentForge/w3-mvp/STAGE_0_ARCH-DEFENSE.md`

## Outcomes

- Week 3 MVP submission package committed and pushed to `gitlab/master` (`7708a678b` → `41f1b9539` → `8ddb17e40` → `95818304d`). Annotated tag `w3-mvp` at the first MVP-package commit.
- All four brief Stage hard gates met: target verified live, full threat-model map shipped with the ~500-word summary, eval suite with ≥3 categories and one live agent role running against prod, ARCHITECTURE.md with summary + Mermaid diagram + four-agent roster.
- Product name "Clinical Adversary" locked across all user-facing W3 docs.
- Demo video recorded against the cheat sheet (Loom link captured for submission).
- Real defensive surface in the W2 target discovered by attacking it: typed `refusal` blocks with reason codes (`blocked_cross_patient_tool_args`, `internal_details_not_available`) that the W2 architecture doc did not document.
- Two confirmed Judge false-positive examples captured with verbatim refusal text (Marcus Hill in cross-patient hijack; tabloid in roleplay framing) — both correct supervisor refusals that the substring rule misclassified. 89% verdict reproducibility across the two captured runs.
- Submission form fields interpreted and answers prepared: deployed-app URL = the **target** (`https://oe.108-61-145-220.nip.io/`); both repo URL fields = the same OpenEMR monorepo (brief-compliant per "Forked from OpenEMR").

## Next steps

- [ ] Submit MVP via Gauntlet portal with the four field values + Additional Notes content drafted at end of session.
- [ ] Push the W3 MVP commits + `w3-mvp` tag to `origin` (GitHub) so both remotes stay in sync.
- [ ] Add the Loom link to the root [`README.md`](../../../../../README.md) "W3 MVP demo video" placeholder.
- [ ] Wednesday: kick off Gate 1 (Postgres ledger schema + backfill + cost governor) per [`W3_TASKS.md`](../../../w3-mvp/W3_TASKS.md). This is the foundational unlock for Gate 2 (LLM Judge tier 2) → Gate 3 (Orchestrator + Documentation Agent) → Gate 5 (Console v1).
- [ ] Hand-label the 30-case Judge calibration ground-truth set (joint with operator) before tier-2 Judge ships — directly motivated by the two FP examples and the 89%-reproducibility finding.
- [ ] Decide live-vs-archived Langfuse posture for prod (currently cloud across both envs; v2 commit for self-hosted captured in the ARCH §11 footnote).

## Links

- Numbered milestone: [process/milestones/week-3/02-w3-mvp-submission.md](../../milestones/week-3/02-w3-mvp-submission.md)
- Bridges from: [process/milestones/week-3/01-prod-deploy-and-cohort-reset.md](../../milestones/week-3/01-prod-deploy-and-cohort-reset.md)
- Submission package commits: `7708a678b`, `41f1b9539`, `8ddb17e40`, `95818304d` on `gitlab/master`
- Tag: `w3-mvp`
- Demo video: `https://www.loom.com/share/1c1476293fce47b7bf06af1fef57bed3`
