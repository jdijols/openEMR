---
date: 2026-04-30
topic: Gate 3 UX — citation shell navigation, chart_section routing, closing chart clears CUI + session wrap
related_milestone: Documentation/AgentForge/process/12-gate1-gate2-complete.md, implementation/clinical-copilot-task-list.md (Gate 3)
---

# Gate 3 navigation, active chart sync, no-chart UX — session journal

## Goal

Finish Gate 3 UX and safety behaviors for the Clinical Co-Pilot rail: citations must not bust the OpenEMR tabs chrome; non-encounter citations should land on meaningful chart surfaces; active patient switches must reload the iframe; closing the chart must clear stale chat / PHI from the rail. Capture evidence for handoff to the next chat to finish remaining Gate 3 rows (PHPUnit pack, task-list closeout).

## Context

Prior work landed nine context endpoints, verification, `citation_navigation`, internal-disclosure refusal, tool-result collection across AI SDK steps, and G3-12 pid polling. Follow-on issues: full-window `window.top.location` on citation fallback; early return in the pid watcher when probe was empty (`cur === ''`) left the last patient’s SPA mounted after chart close.

## Key decisions

### Decision: Navigate citations inside tabs chrome, not `window.top.location`

- **Prompt:** (Paraphrase) Citations navigate to demographics in a way that destroys the rail and top tabs; needs fixing before submission.
- **Recommendation:** Prefer `goToEncounter` / `loadCurrentPatient` / `navigateTab` / `top.RTop.location` matching existing OpenEMR patterns (`tabs_view_model.js`), never full top navigation.
- **Outcome:** Implemented in `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig` (`navigateEncounterInChrome`, `navigateDemographicsInChrome`); asserted no `window.top.location.href` in `tests/Tests/Isolated/Modules/AgentForge/RailContainerStaticStructureTest.php`; `ARCHITECTURE.md` citation section updated.

### Decision: Respect `chart_section` + `params.section` instead of demographics + NAV_LIMITED for everything

- **Prompt:** Clicking citations showed “Limited navigation…” and reload only; should this wait for a later gate?
- **Recommendation:** Source packs already carry `kind: chart_section` and `params.section`; wire host URLs now (Issues `stats_full.php` categories, `labdata.php`, `history.php`, vitals trend, documents controller) rather than defer.
- **Outcome:** `urlForChartSection` + handler branch for `hint.kind === 'chart_section'` in `rail_container.html.twig`; `NAV_LIMITED` only for unknown kinds.

### Decision: Closing the chart must blank/reload the panel iframe like a pid transition

- **Prompt:** Confirmed closing patient leaves prior chat visible; should clear when no chart.
- **Recommendation:** Remove `if (cur === '') return` from pid poll—treat transition to empty pid like any other pid change (`blankPanelIframe`, reload `panel.php` when rail open).
- **Outcome:** Interval block now only compares `cur !== prevPid`; static test forbids resurrecting empty-pid bailout; aligns with G3-09 / PHI hygiene.

### Decision: Unified empty-chart copy for `no_patient_context` and `no_chart_bound`

- **Prompt:** (Implicit) Same user expectation whether first load or after reload from `panel.php` with empty UUID.
- **Recommendation:** Present the PRD-aligned “Open a patient chart to begin” block when either handshake path yields no actionable chart UUID.
- **Outcome:** `agentforge/cui/src/App.tsx` treats both messages with the same primary heading + hint copy.

## Trade-offs and alternatives

- **Row-level citations (scroll to allergy row)** — deferred; MVP uses section URLs only.
- **G3-01 full PHPUnit four-scenario pack per endpoint** — still optional tier-6 backlog vs schedule; automation can land in next session.

## Tools, dependencies, commands

_Local verification invoked during development (not exhaustive):_

- `composer phpunit-isolated -- --filter RailContainerStaticStructureTest`
- `cd agentforge/cui && npm test -- --run`

## Files touched

- **Modified:** `interface/modules/custom_modules/oe-module-agentforge/templates/rail_container.html.twig`
- **Modified:** `tests/Tests/Isolated/Modules/AgentForge/RailContainerStaticStructureTest.php`
- **Modified:** `ARCHITECTURE.md`
- **Modified:** `agentforge/cui/src/App.tsx`

_Earlier in the same Gate 3 thread (summary; not necessarily re-listed in git here):_

- Orchestrator/tool evidence/handshake/MessageList/context endpoints, `Documentation/AgentForge/implementation/dev-spend-log.md`, `docker/agentforge/README.md`, `Documentation/AgentForge/implementation/clinical-copilot-task-list.md`, `PRD.md`, Vitest/PHPUnit additions under `agentforge/api/test/`, `agentforge/cui/src/chat/*.test.*`.

## Outcomes

- Citation clicks keep the tabs shell and rail mounted; encounter + chart sections route to appropriate patient-file URLs.
- Switching patient and **closing** the chart both reset iframe load state so React remount shows empty state (`panel.php` with empty UUID) rather than lingering chat.
- User confirmed: encounter citation smoke, allergy citation → Issues allergy view, closing chart clears prior thread.

## Next steps

- [x] In `clinical-copilot-task-list.md`: refresh Gate 3 **Implementation status**; see [`0430-T1437-gate3-g300-tasklist-closeout.md`](./0430-T1437-gate3-g300-tasklist-closeout.md).
- [ ] **G3-11 done proof:** append at least three storyboard transcripts (patient ids + cited “what changed” / briefing) — same week folder; template in 0430-T1437.
- [x] **G3-00:** migrate proof cited in `docker/agentforge/README.md` + [`0430-T1437`](./0430-T1437-gate3-g300-tasklist-closeout.md).
- [ ] **Optional G3-01:** PHPUnit four-scenario packs per Context endpoint (`tier 6`).
- [ ] Proceed to Gate 4 only after **G3-11** (and any other MUST rows you treat as blocking) are consciously green; **G3-00** is satisfied for migrations.

## Links

- Task list: [clinical-copilot-task-list.md](../../../implementation/clinical-copilot-task-list.md)
- Prior handoff (Gate 2): [0430-T0050-gate2-session-handoff-g212-g214.md](./0430-T0050-gate2-session-handoff-g212-g214.md)
