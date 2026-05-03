# Clinical Copilot

> An OpenEMR-embedded conversational copilot for adult primary care visits.
> Built on OpenEMR. Developed during the Gauntlet AI AgentForge program.

**Live demo:** [http://108-61-145-220.nip.io:8300/](http://108-61-145-220.nip.io:8300/) · **Login:** `physician` / `password123` (synthetic data only)

---

## Doctors don't need medical advice from an AI

At least not today. What they need is their time back.

Physicians in adult primary care spend nearly two hours on EHR documentation and clerical work for every one hour of direct patient face time. That ratio — not patient complexity, not clinical decision-making — is the largest single driver of physician burnout in modern outpatient practice. The chart, not the patient, is the problem.

Clinical Copilot is built around that observation. It does not interpret labs, suggest diagnoses, or recommend treatments. It pulls data from the patient's chart on request, proposes structured writes from physician dictation (only after explicit confirmation), and otherwise stays out of the way. The conversational interface is the surface; the work underneath is **automation, not advice**.

\* Sinsky C, Colligan L, Li L, et al. *"Allocation of Physician Time in Ambulatory Practice: A Time and Motion Study in 4 Specialties."* Annals of Internal Medicine. 2016;165(11):753-760.

---

## What it does

Clinical Copilot embeds a conversational panel inside an OpenEMR chart, scoped to one workflow: a **new or returning adult primary care visit**. It assists the physician across three moments:

- **Before the room** — a source-cited case presentation drawing on the day's front-desk and medical-assistant intake, with linked prior-visit context. Read-only.
- **In the room** — physician-only dictation that turns into structured proposals across the full V1 CRUD surface: chief complaint (create / update / clear), vitals incl. pain, height, weight (create / update / void), tobacco status (create / update), allergy add or reaction/severity update, and clinical notes (create / update / soft-delete). Nothing writes without explicit confirmation. Soft-deletes preserve the row in the database for audit.
- **After the room** — the same conversation thread persists for follow-up Q&A against the chart and the visit transcript, plus a recap of confirmed, rejected, and pending proposals.

That is the entire surface area. It is intentionally narrow. The ten V1 use cases (UC-A through UC-J), the target persona, the refusal posture, and the full traceability mapping from each capability to its tool path are documented in detail in [USERS.md](USERS.md).

---

## How it handles arbitrary input

A physician can type anything into the chat field. The agent's response is bounded by what the system is allowed to do. Every input falls into one of four buckets:


| Physician asks for...                                        | Clinical Copilot...                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Data already in this patient's chart**                     | Calls a bounded read tool (allergies, medications, vitals, problems, labs, notes), cites every claim with a clickable source UUID, and renders the answer in the chat. Negative claims (*"no allergies on file"*) are only allowed if the empty-query was actually performed. |
| **A new fact to add to the chart**                           | Proposes a structured write for one of the V1 targets. The proposal renders as a card in the thread; nothing writes without an explicit *confirm* turn.                                                                                                                       |
| **Clarification when input is ambiguous**                    | Asks back. The deterministic vitals parser reports `uncertain` rather than guessing; ambiguous dictation (*"BP was 160/90 last time, but today looks better"*) is flagged as historical context, not saved.                                                                   |
| **Medical advice, diagnosis, or general clinical knowledge** | Politely declines and redirects: *"I'm not an advice agent — I can pull data from this chart or help you save data to it. For clinical guidance, that's your judgment."* Sustained pressure firms the redirect into a refusal block.                                          |


The graduation matters: a first out-of-scope request meets a light, conversational redirect; persistence hardens it. Behind all four buckets sits a deterministic verification layer — every clinical claim must cite a tool result from the same turn, and any uncited claim is stripped before the response is shown. See [VERIFICATION.md](VERIFICATION.md) for the full enforcement story and its honest list of known limitations.

---

## What this is NOT

Clinical Copilot deliberately scopes itself out of:

- **Medical advice or diagnosis.** The system does not recommend treatments, suggest diagnoses, or interpret clinical findings. Those decisions belong to the physician.
- **External knowledge sources.** No PubMed lookups, no drug-interaction databases, no general-medicine Q&A in V1.
- **Orders, prescriptions, billing codes, or lab orders.** Each is a clinically dangerous write surface that needs deeper integration than V1 ships.
- **Encounter note finalization or signing.** V1 supports authoring, revising, and soft-deleting physician progress-note text inside an open encounter, but does not finalize or sign encounter documentation.
- **Allergy delete, resolution, or inactivation.** Allergy add and reaction/severity update are supported; deletion is intentionally out of scope (audit too high-risk for V1).
- **Ambient recording or patient audio capture.** Physician dictation only, push-to-talk; no audio file is retained.
- **Pediatric, ED, urgent-care, surgical, specialist, dental, or mental-health-only workflows.** V1 is scoped to new or returning adult primary care.
- **Autonomous writes of any kind.** Every chart write is gated on an explicit physician confirm.

These are not aspirational gaps. Several of them — medical advice, external knowledge, autonomous clinical decision support — sit on the wrong side of an FDA software-as-medical-device classification line, and Clinical Copilot stays well clear of it.

---

## What's planned for V2

V2 deepens what V1 already proved: the propose → confirm → write contract works, and the four-layer verification gate handles UUID citations from any tool source. V2 extends that pattern across the **full patient chart**, so the agent can read, create, update, and delete every data type a clinician touches in a chart workflow — not just the five confirmed-write targets V1 ships with. The work is sequenced into three sub-versions:

- **V2.1 — Clinical core:** allergies (closing the CRUD V1 left at add/update), medical problems, medications, prescription records, immunizations.
- **V2.2 — Care coordination:** care team, treatment intervention preferences, care experience preferences.
- **V2.3 — Operational chart:** demographics, billing/insurance, patient messages, patient reminders.

Architecturally this is a clean extension, not a redesign. Every V2 surface uses the same propose → confirm → write pipeline, the same UUID-citation gate, and the same active-chart binding model V1 ships with. **External evidence grounding** — the `lookup_clinical_evidence` tool over PubMed, NEJM, or OpenEvidence that earlier drafts proposed for V2 — moves to V3, where it can get a dedicated design pass for source currency, hallucinated-citation risk, and external-URL citation rendering rather than being bolted onto a chart-CRUD release. See [VERIFICATION.md §7](VERIFICATION.md) for the V1 limitation that motivates V3 external evidence, and [Documentation/AgentForge/implementation/v2-roadmap.md](Documentation/AgentForge/implementation/v2-roadmap.md) for the full V2 sequencing and V3 candidate set.

---

## Architecture in brief

Two services on one Linux VPS, glued together through Docker Compose:


| Component                   | Tech                           | Role                                                                                                      |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **OpenEMR + custom module** | PHP, MariaDB                   | Authenticated shell, GACL gating, chart context, and the bounded write executor (`oe-module-agentforge`). |
| **Clinical Copilot CUI**    | React + Vite + TypeScript      | Conversational UI in an iframe right rail of the OpenEMR header.                                          |
| **Agent API**               | Node 20 + Hono + Vercel AI SDK | LLM orchestration, typed tools, verification gate, transcript store, STT relay, Langfuse traces.          |


The CUI never holds LLM API keys; only the Agent API talks to the model and STT providers, both under BAA-class egress. The agent never touches the database directly — chart writes flow through the PHP module under the physician's existing OpenEMR session and ACL.

[ARCHITECTURE.md](ARCHITECTURE.md) has the full system diagram, the for-instructors decision table, the trust-boundary discussion, and per-component detail.

---

## Try it

- **Live demo:** [http://108-61-145-220.nip.io:8300/](http://108-61-145-220.nip.io:8300/) — `physician` / `password123`, synthetic patients only
- **Local development (Docker):** see [docker/development-easy/](docker/development-easy/) and [Documentation/AgentForge/process/04-stage1-local-dev-runbook.md](Documentation/AgentForge/process/04-stage1-local-dev-runbook.md)
- **VPS deployment runbook:** see [Documentation/AgentForge/process/09-vps-live-deployment.md](Documentation/AgentForge/process/09-vps-live-deployment.md)

---

## Documentation

The submission package and project context, in the order a reader should approach them:


| Document                             | What it covers                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [USERS.md](USERS.md)                 | Target user (Dr. Maya Reynolds, adult PCP, new or returning patients), the ten V1 use cases (UC-A through UC-J: pre-room case presentation, single- and cross-domain Q&A, four confirmed-write surfaces, refusal posture, documentary med reconciliation, documentary abnormal lab surfacing), CRUD matrix, explicit non-goals, refusals, degraded behavior. |
| [ARCHITECTURE.md](ARCHITECTURE.md)   | Technical integration plan: framework choices, system diagram, trust boundaries, deployment model, known tradeoffs.                                                                                                                                                                                                                                          |
| [AUDIT.md](AUDIT.md)                 | Stage 3 OpenEMR audit findings — the security, performance, architecture, data-quality, and compliance constraints that shaped the build.                                                                                                                                                                                                                    |
| [VERIFICATION.md](VERIFICATION.md)   | Chart-fidelity gate: citation enforcement, negative-claim backing, range guard, med-status warnings — and what verification *does not* catch.                                                                                                                                                                                                                |
| [EVALUATION.md](EVALUATION.md)       | Eval suite: ten deterministic check rules (stop-the-line invariants + instructor-named failure modes + the constraint-boundary "automation, not advice" gate), 39 curated cases, defense of scope.                                                                                                                                                           |
| [OBSERVABILITY.md](OBSERVABILITY.md) | Langfuse tracing: per-turn forensic reconstruction, the four required questions answered from logs, PHI redaction.                                                                                                                                                                                                                                           |
| [COSTS.md](COSTS.md)                 | Actual dev spend (~$258 build total of which $3.34 is variable LLM), per-encounter unit economics, projections at 100 / 1K / 10K / 100K clinicians, architectural inflection points per tier, shipped cost mitigations.                                                                                                                                       |
| [PRD.md](PRD.md)                     | Engineer-facing implementation spec, mapped 1:1 to gates and acceptance criteria.                                                                                                                                                                                                                                                                            |
| [JOURNEY.md](JOURNEY.md)             | Physician's-eye narrative of one full visit through the shipped CUI.                                                                                                                                                                                                                                                                                         |
| [TASKS.md](TASKS.md)                 | Gate-by-gate implementation tracking, dependency-ordered.                                                                                                                                                                                                                                                                                                    |


The program-context build documentation — process journals, milestone closeouts, dated session entries — lives under [Documentation/AgentForge/](Documentation/AgentForge/).

---

## Built on OpenEMR

Clinical Copilot is a fork of [OpenEMR](https://open-emr.org), the open-source electronic health records and practice management system. The fork preserves OpenEMR's licensing (GPL v3) and its upstream codebase under `src/`, `library/`, `interface/`, and `sql/`. Clinical Copilot's additions are:

- `interface/modules/custom_modules/oe-module-agentforge/` — the PHP module that handles authentication, GACL gating, chart context, the launch handshake, and confirmed writes.
- `agentforge/api/` — the Node + TypeScript orchestrator (LLM, tools, verification, evaluation suite).
- `agentforge/cui/` — the React iframe SPA.
- `Documentation/AgentForge/` — process documentation from the build.

Internal directory and identifier names referencing "agentforge" are preserved from the cohort program that originated this work; renaming them would require coordinated changes across the GACL ACL strings (database state), Docker Compose service names, Caddy routing, and the live-deployment URL paths. That cleanup is deferred to post-submission to avoid disrupting the running demo.

For OpenEMR's own documentation (installation, contributing, REST API, FHIR, Docker), see [CONTRIBUTING.md](CONTRIBUTING.md), [API_README.md](API_README.md), [FHIR_README.md](FHIR_README.md), and [DOCKER_README.md](DOCKER_README.md). The OpenEMR project's website is at [open-emr.org](https://open-emr.org).

---

## License

[GPL v3](LICENSE) — inherited from OpenEMR. Substantive changes introduced by this fork are listed in the build documentation under [TASKS.md](TASKS.md) and [Documentation/AgentForge/process/](Documentation/AgentForge/process/).