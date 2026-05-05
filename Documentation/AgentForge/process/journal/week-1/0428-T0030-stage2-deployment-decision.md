---
date: 2026-04-28
topic: Stage 2 deployment stack choice + GitLab push path
related_milestone: [process/milestones/week-1/05-stage2-deployment-decision.md](../../milestones/week-1/05-stage2-deployment-decision.md)
---

# Stage 2 deployment decision — session journal

## Goal

Move AgentForge **Stage 2** forward: unblock **GitLab** hosting of the fork, decide **target production deployment** (without executing provisioning the same night), and capture rationale so **architecture diagrams** and upcoming **Stage 3 audits** (security, performance, architecture, data quality, compliance) align with a single infrastructure story.

## Context

Stage 1 (local Docker easy-dev + demo data) was already verified ([0427-T2145-stage1-openemr-demo-verified.md](0427-T2145-stage1-openemr-demo-verified.md)). Stage 2 requires a **publicly reachable** deployment URL eventually; Gauntlet notes the **final agent targets the same infrastructure**. The user had **no SSH keys** initially (`Permission denied (publickey)` to Gauntlet GitLab), then shifted to **HTTPS + Personal Access Token** after creating an **empty** GitLab project. Evening time pressure favored **locking the deployment decision** and deferring VPS execution until after rest / the next day.

## Key decisions

### Decision: GitLab authentication path

- **Prompt:** "`Permission denied (publickey)` when pushing to `labs.gauntletai.com:22022` … help me out" / later PAT usage confusion.
- **Recommendation:** Root cause was **no SSH key material** on the machine for GitLab to trust; alternatively use **HTTPS remote + PAT** as password when Git prompts—create **empty project first**, then `git remote add` + `git push`.
- **Outcome:** User adopted **HTTPS + PAT**; fork pushed successfully. (Optional Ed25519 key generated earlier available if SSH is preferred later.)

### Decision: Target hosting model for OpenEMR + future agent

- **Prompt:** Compare **VPS + Docker Compose** vs **Railway / Render / Fly** vs **AWS / GCP**; minimize rework when adding the agent; consider **local LLM on-box** for real-world HIPAA narrative vs Gauntlet’s assumed cloud-provider agreements.
- **Recommendation:** Prefer **single VPS + Docker Compose** aligned with OpenEMR’s **production-style container story** in-repo—not because most clinics run Compose, but because **upstream artifacts** (Compose layouts, images) map cleanly. Add the agent as **another Compose service** on the **same Docker network**. **Hyperscale cloud** deferred as disproportionate ops for Stage 2. **Vercel** ruled out for **full EMR** (PHP + MariaDB + persistence). **Railway-class PaaS** viable but platform-specific volume/network limits remain a discovery tax versus **one compose file on one VM**.
- **Outcome:** Documented in [process/milestones/week-1/05-stage2-deployment-decision.md](../../milestones/week-1/05-stage2-deployment-decision.md).

### Decision: Defer live provisioning vs diagram / audit priority

- **Prompt:** Late evening constraint + 10 a.m. Gauntlet meeting—finish deploy tonight vs prioritize diagram accuracy?
- **Recommendation:** **Decision-first**: diagrams can reflect **target topology** without a live URL; full HTTPS/VPS bring-up can slip to a focused block after sleep.
- **Outcome:** Execution explicitly **deferred**; README/process trail records decision without claiming deployed URL yet.

### Decision: Compliance framing for audits

- **Prompt:** HIPAA, BAAs, local model on VPS vs cloud APIs; presearch checklist alignment.
- **Recommendation:** Gauntlet allows assuming **provider non-training** agreements for classwork; **Stage 3 audits** should still treat **logging, retention, breach notification, PHI→LLM boundaries** seriously using [03-presearch-checklist.md](../../milestones/week-1/03-presearch-checklist.md). **Local inference on VPS** is a plausible production direction but **not automatic HIPAA compliance**—still needs encryption, access control, and vendor posture around the VPS itself.
- **Outcome:** Fed into process/05 **future outlook** section for agent + optional local LLM sidecar.

## Trade-offs and alternatives

- **Railway / Render / Fly** — Faster HTTPS UX often; still need **OpenEMR + DB persistence + multi-service** validation against provider limits—acceptable spike path if Compose-on-VPS looked blocked.
- **AWS / GCP** — Strong when scale/IAM/enterprise patterns matter; **higher baseline complexity** than needed for AgentForge Stage 2 demo scope.
- **Vercel** — Excellent for serverless/frontend patterns; **wrong runtime shape** for full OpenEMR core deployment.

## Tools, dependencies, commands

- GitLab: **empty project** → clone URL (**HTTPS**).
- `git remote add gitlab <https-url>` (or equivalent); `git push -u gitlab "$(git rev-parse --abbrev-ref HEAD)"` — **username** + **PAT as password** at credential prompt; optional `git config credential.helper osxkeychain` on macOS.
- Earlier troubleshooting: `ssh -p 22022 git@labs.gauntletai.com` for SSH verification (optional after registering pubkey).

## Files touched

- **Created:** `Documentation/AgentForge/process/milestones/week-1/05-stage2-deployment-decision.md`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0428-T0030-stage2-deployment-decision.md`
- **Modified:** `Documentation/AgentForge/README.md` (process trail table)

## Outcomes

The **numbered trail** now includes **process/05** as the canonical **Stage 2 deployment decision** record (VPS + Compose rationale, alternatives, agent/local-LLM outlook). GitLab workflow for this fork is **documented** (HTTPS/PAT path). **Live VPS provisioning** remains intentionally **out of scope** for this journal’s closing state.

## Next steps

- [ ] Provision VPS; install Docker + Compose; align with `docker/production` expectations; TLS + DNS; capture **public Stage 2 URL** when ready.
- [ ] Stage 3 audits per plan: security, performance, architecture, data quality, compliance/regulatory—guided by [03-presearch-checklist.md](../../milestones/week-1/03-presearch-checklist.md).
- [ ] Architecture diagram: client → TLS → OpenEMR container → MariaDB; future **agent** + optional **local inference** sidecar on same host/network.

## Links

- Numbered milestone: [process/milestones/week-1/05-stage2-deployment-decision.md](../../milestones/week-1/05-stage2-deployment-decision.md)
- Presearch checklist: [process/milestones/week-1/03-presearch-checklist.md](../../milestones/week-1/03-presearch-checklist.md)
