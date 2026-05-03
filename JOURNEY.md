# Physician Journey — AgentForge Clinical Co-Pilot

> **Status:** Working draft, kept in sync with the shipped CUI as of Gate 6 close. This document narrates one full encounter — and the clinic day around it — from the physician's point of view, through the lens of a single conversational thread.

The PDF's first agent requirement is *"a multi-turn AI agent that can receive follow-up questions, maintain context across a conversation, and invoke tools to retrieve and reason over patient data."* This document describes how the shipped CUI delivers that for our V1 user — Dr. Maya Reynolds, an adult primary care physician working through an 18-24 visit clinic day — across three phases per visit: **pre-room**, **in-room**, and **post-room**. Implementation depth lives in [`PRD.md`](./PRD.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), and [`Documentation/AgentForge/`](./Documentation/AgentForge/); this file is the human story.

## Guiding principles

- **The panel is the conversation.** One chat thread per visit, owned by the patient's chart, persisted for two hours via sessionStorage keyed by `patient_uuid`. Auto-brief, dictation, typed follow-ups, structured proposals, confirmations, refusals, and post-room Q&A all flow through that one thread. The thread survives panel refresh and intra-day re-entry to the same chart. This is the PDF's *"maintain context across a conversation,"* made concrete.
- **Two buttons own the room.** Start dictation and stop dictation are the entire in-room hardware-style controls; everything else is a turn through the chat.
- **Confirm, don't compose.** Structured writes appear as proposal cards inside the thread. The physician confirms or rejects — by click, or by saying "yes, confirm." No hunting through forms, no retyping.
- **No friction during the visit.** The physician should not have to navigate, type the same fact twice, or compose chart fields. Dictation flows directly into the orchestrator; structured proposals appear inline; confirmation is a single touch or a single phrase.
- **Refusals are a feature, not an exception.** When the agent is uncertain, when a record is missing, when STT errors, when OpenEMR rejects a write — the agent says so in the thread, names the failure with a typed code and correlation ID, and leaves the proposal unresolved rather than guessing.

## Encounter binding — implicit on the schedule path

When the physician clicks a patient from the day's schedule (calendar or patient tracker), `af_appointment_id` and `af_appointment_date` thread through `demographics.php` and `AppointmentEncounterBinder` resolves the appointment-day encounter automatically. The session encounter, the AgentForge JWT, and the host "Open Encounter" all align on that visit's date — not the server's literal "today" — so confirmed writes land cleanly without manual setup. See [`Documentation/AgentForge/process/17-encounter-scoped-chart-bind-and-brief.md`](./Documentation/AgentForge/process/17-encounter-scoped-chart-bind-and-brief.md).

The direct-chart-search path (typing a patient name into the patient search field, no schedule click) still requires the physician to save an encounter before encounter-scoped writes will bind. This is the next gap to close, tracked in [`Documentation/AgentForge/implementation/open-questions.md`](./Documentation/AgentForge/implementation/open-questions.md).

For local Docker demos, run [`contrib/util/agentforge/seed_visit_intake.php`](contrib/util/agentforge/seed_visit_intake.php) after cohort + appointment seeders so each demo-day visit has an intake encounter dated that week (see [Demo data seeding](Documentation/AgentForge/README.md#demo-data-seeding-local-docker) in `Documentation/AgentForge/README.md`).

## The shape — one chat thread per visit

The CUI is a chat panel that mounts in the right rail when the physician opens a chart. Every interaction is a turn through that one thread:

- **The brief is the first assistant turn.** On chart open, the panel auto-fires `runPresent()` and the brief lands as the first assistant message — three deterministic sections (*Reason for visit*, *Recorded most recently*, *Previous visits*) with encounter-scoped vitals and source-cited prior summaries. Each clinical claim emits a `source_pack` whose `navigation_hint` deep-links into the chart through host-shell `postMessage`.
- **Dictation and typing share one pipeline.** The physician taps **Start dictation** for push-to-talk capture (physician-only audio, in-memory only, never retained — AssemblyAI under BAA-class egress). Dictated text flows through the same `/chat` orchestrator as typed input, the same propose-write tools, the same verification gate. The user bubble shows a *Dictation* badge instead of a `[dictation]` text prefix; the agent's path is identical.
- **Proposals appear turn-by-turn.** Every dictated visit fact (chief complaint; vitals incl. pain/height/weight; tobacco status; allergy add or reaction/severity update) produces an immediate structured proposal card inside the thread, citing the dictation turn that produced it. The physician confirms or rejects before the next dictation.
- **Confirm by click or by voice.** A spoken "yes, confirm" while a card is open accepts the proposal in parallel with the chat path; the resolved state round-trips through the conversation cache and the card stays accepted across reload.
- **Refusal stays inline.** Ambiguous trigger ("160/90 last time, but today looks better"), missing encounter, OpenEMR rejection, STT provider error — each surfaces in the thread with a typed code and correlation ID, and the proposal stays unresolved.
- **The thread is per-patient and persists across the day.** sessionStorage keys by `patient_uuid` with a sliding 2-hour TTL, so re-entering chart A after seeing chart B replays A's full thread including resolved proposals.

## Journey diagram

```mermaid
flowchart TB
    classDef phase stroke-width:2px
    classDef click font-weight:bold
    classDef refusal stroke-dasharray:4 4

    subgraph PreRoom [Pre-room — UC-A]
        direction TB
        scheduleClick["Click patient on today's schedule"]:::click
        chartOpen["Chart opens; rail mounts<br/>encounter bound to appointment day"]
        autoBrief["Assistant turn 1 — auto-brief<br/>Reason for visit · Recorded most recently · Previous visits<br/>each claim cites a source pack"]
        followUp["Optional turn 2 — follow-up Q&A<br/>typed or dictated"]
        cite1[("Tap a citation → host shell deep-links in chart")]
        autoBrief --> cite1
    end

    subgraph InRoom [In-room — UC-B]
        direction TB
        clickStart["Click Start dictation"]:::click
        dictate["Physician-only push-to-talk<br/>audio in-memory only · never retained"]
        orchestrator["Same /chat orchestrator as typed input<br/>propose-write tools · verification gate"]
        proposal["Structured proposal card inline<br/>cites the dictation turn"]
        confirmChoice{Confirm path}
        clickConfirm["Click Confirm"]:::click
        voiceConfirm["Say 'yes, confirm'"]
        write["Module write · log_from='agent'<br/>OpenEMR accepts or rejects"]
        nextDictation["Next dictation in same thread"]
        refusal["Refusal turn<br/>ambiguous · rejected · STT error<br/>typed code + correlation ID"]:::refusal
        clickEnd["Click Stop dictation"]:::click
    end

    subgraph PostRoom [Post-room — UC-C]
        direction TB
        recapAsk["Physician asks recap<br/>typed or dictated"]
        recap["Assistant recap<br/>confirmed · rejected · unresolved · cited"]
        followQA["Follow-up Q&A against transcript + chart"]
        nextVisit["Next patient on schedule"]:::click
    end

    subgraph Day [Across the clinic day]
        direction TB
        threadPersist["sessionStorage keyed by patient_uuid<br/>2h sliding TTL · proposal state round-trips"]
    end

    scheduleClick --> chartOpen --> autoBrief --> followUp
    followUp --> clickStart
    clickStart --> dictate --> orchestrator --> proposal --> confirmChoice
    confirmChoice -->|click| clickConfirm --> write
    confirmChoice -->|voice| voiceConfirm --> write
    orchestrator -.-> refusal
    write --> nextDictation
    nextDictation --> dictate
    nextDictation --> clickEnd
    clickEnd --> recapAsk --> recap --> followQA --> nextVisit
    nextVisit --> scheduleClick

    threadPersist -. "thread resumes on chart re-entry" .-> autoBrief

    class PreRoom,InRoom,PostRoom,Day phase
```

## Sample turn sequences

Illustrative; not transcripts of a real visit. Bracketed cite tokens stand in for source-pack references that the rail tap-jumps to in chart.

**Pre-room — auto-brief plus a typed follow-up**

> *Assistant (turn 1, auto-fired):* "**Reason for visit** — Sore throat and fever *[encounter 282]*. **Recorded most recently** — BP 132/84, HR 78, Temp 98.6 F *[vitals row 4117]*. **Previous visits** — 2026-02-14: A1c follow-up, metformin increase noted *[encounter 271]*."
>
> *Physician (turn 2, typed):* "What was her A1c last time?"
>
> *Assistant (turn 3):* "Last A1c on file is 8.2 from 2026-01-30 *[lab result 9981]*; prior was 7.4 from 2025-08-15 *[lab result 9612]*."

**In-room — refusal, then a confirmed write via voice**

> *Physician (dictated):* "Last time her blood pressure was around 160 over 90, but today looks better."
>
> *Assistant:* "I heard a blood pressure value, but this sounds like historical context rather than today's vitals. I will not save it."
>
> *Physician (dictated):* "Vitals: BP 132 over 84, heart rate 78, temp 98.6, pain 3 out of 10."
>
> *Assistant (proposal card):* "Proposed vitals — BP 132/84, HR 78, Temp 98.6 F, pain 3/10. Save to today's encounter?"
>
> *Physician (dictated):* "Yes, confirm."
>
> *Assistant:* "OpenEMR accepted the write. Vitals saved."

**In-room — write rejected by OpenEMR**

> *Physician:* (clicks Confirm)
>
> *Assistant:* "Confirm failed (`duplicate_proposal`) — corr `8e2f1c…`. The proposal stays unresolved in this thread."

**Post-room — recap and follow-up**

> *Physician (typed):* "What did we capture?"
>
> *Assistant:* "Confirmed writes: chief complaint, vitals (incl. pain), tobacco status. No allergy updates this session. One unresolved item: you mentioned home glucose readings but did not dictate a structured capture — I cannot save that in V1."
>
> *Physician (typed):* "Show me her allergies on file."
>
> *Assistant:* "On file: penicillin (hives, moderate, recorded 2024-09-10). No other active allergies. *[allergy list]*"

## What success looks like

This journey is healthy on a clinic day when:

- The physician dictated and confirmed structured visit data on every visit that needed it, without typing chief complaint, vitals, tobacco, or allergy fields manually.
- Each visit thread had at least one assistant-cited claim the physician could tap to verify in chart.
- Refusal turns appeared and stayed visible whenever the agent was uncertain, the encounter context was missing, or OpenEMR rejected a write — surfacing the typed code and correlation ID in the thread.
- The panel survived refresh, encounter changes, and chart re-entry without losing thread state.
- At end of day, the conversation cache holds zero orphaned proposals — every proposed write was confirmed, rejected, or explicitly left unresolved with a named reason.

Click count is downstream of those outcomes; the thread itself is the unit of work, not the click budget.

## Eval coverage

Each journey moment has a corresponding eval case in [`agentforge/api/eval/cases/curated/`](./agentforge/api/eval/cases/curated/). New eval cases must reference the journey moment they cover.

| Journey moment | Curated eval cases |
| --- | --- |
| UC-A pre-room briefing — claims grounded in source packs | [`baseline-vitals-supported.json`](./agentforge/api/eval/cases/curated/baseline-vitals-supported.json), [`neg-claim-allergies-backed.json`](./agentforge/api/eval/cases/curated/neg-claim-allergies-backed.json), [`neg-claim-labs-unbacked.json`](./agentforge/api/eval/cases/curated/neg-claim-labs-unbacked.json) |
| UC-B confirmed vitals write | [`baseline-vitals-supported.json`](./agentforge/api/eval/cases/curated/baseline-vitals-supported.json) |
| UC-B refusal — historical-context BP | [`adv-vitals-ambiguous-bp.json`](./agentforge/api/eval/cases/curated/adv-vitals-ambiguous-bp.json) |
| UC-B refusal — allergy delete blocked | [`adv-allergy-delete-rejected.json`](./agentforge/api/eval/cases/curated/adv-allergy-delete-rejected.json) |
| UC-B refusal — orders / prescriptions / immunizations out of scope | [`adv-order-write-rejected.json`](./agentforge/api/eval/cases/curated/adv-order-write-rejected.json), [`adv-prescription-write-rejected.json`](./agentforge/api/eval/cases/curated/adv-prescription-write-rejected.json), [`adv-immunization-write-rejected.json`](./agentforge/api/eval/cases/curated/adv-immunization-write-rejected.json) |
| Cross-patient binding block | [`adv-cross-patient-blocked.json`](./agentforge/api/eval/cases/curated/adv-cross-patient-blocked.json) |
| Prompt-injection refusal | [`adv-prompt-injection-system-prompt.json`](./agentforge/api/eval/cases/curated/adv-prompt-injection-system-prompt.json), [`adv-prompt-injection-tool-dump.json`](./agentforge/api/eval/cases/curated/adv-prompt-injection-tool-dump.json) |
| UC-C post-room recap and Q&A | covered by orchestrator + verification suites; no curated standalone yet |

## Where to go next

- Spec and invariants: [`PRD.md`](./PRD.md), with stop-the-line tests in [`Documentation/AgentForge/implementation/clinical-copilot-task-list.md`](./Documentation/AgentForge/implementation/clinical-copilot-task-list.md).
- Architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- User and use-case definitions: [`USERS.md`](./USERS.md).
- Process trail and decisions: [`Documentation/AgentForge/README.md`](./Documentation/AgentForge/README.md).
- Encounter binding for the appointment-day path: [`Documentation/AgentForge/process/17-encounter-scoped-chart-bind-and-brief.md`](./Documentation/AgentForge/process/17-encounter-scoped-chart-bind-and-brief.md).
- Open product questions: [`Documentation/AgentForge/implementation/open-questions.md`](./Documentation/AgentForge/implementation/open-questions.md).

*Working draft — kept in sync with the shipped CUI; revise as the journey and the product converge.*
