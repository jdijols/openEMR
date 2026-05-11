# 01 — Prod deploy, post-deploy bug triage, cohort reset

Single-step milestone covering the 5/10 → 5/11 marathon that finalized
the W2 work for grader demo: deploy the 12 commits since the
[5/8 HTTPS retrofit](../week-2/05-https-retrofit-deploy.md) (patient-dashboard React app + W2 final polish +
problem_list addition), resolve five bugs surfaced by browser smoke,
reset the four W2 cohort patients to a fresh new-patient-intake state on
both local and prod, and prepare the multi-day appointment cohort for
realistic walkthrough by graders.

## Decisions

- **Prod tip at `1556a7fcf`** after four serial commits landed
  (`311ac9ef5` → `5d60c1362` → `ce88b5d0f` → `1556a7fcf`). Pushed to
  both `gitlab/master` and `origin/master`.
- **Bug #3 idempotency-hit fix** is the durable counterpart to the
  workflow gap that **local-→-VPS DB clone does NOT copy document
  filesystem bytes**. Re-uploads after a DB clone now re-register a
  fresh OpenEMR document row when the sidecar's stored id points to a
  wiped row.
- **`problem_list` is now a real intake-bundle write target** —
  schema + prompt + bundle assembler + dispatcher + 5 PHP files +
  modal label all landed together so medical problems on the intake
  form persist via `lists.type='medical_problem'`.
- **Encounter binder fallback** so a non-today appointment-day
  encounter still auto-opens at chart-load for multi-day cohort
  demos. Production tracker/appointment-context paths unchanged.
- **Cohort reset uses targeted SQL + filesystem wipe**, not a full
  re-clone, so non-cohort patients' rich pre-checkin setup is
  preserved. The full session journal captures the surprising mid-reset
  encounter loss + targeted re-import recovery.

See full Key Decisions + Trade-offs in
[`process/journal/week-3/0511-T1257-prod-deploy-and-cohort-reset.md`](../../journal/week-3/0511-T1257-prod-deploy-and-cohort-reset.md).

## Deferred (Option B)

Lab observations extracted by the agent persist to
`agentforge_w2/_obs/<sha256>.json` sidecar JSON; the dashboard's Labs
card reads them via a custom PHP endpoint that reshapes them into a
FHIR Observation Bundle. Schema-correct per the W2 brief, but not in
OpenEMR's canonical `procedure_order` / `procedure_report` /
`procedure_result` tables — `/apis/default/fhir/Observation` won't
return them. Future work to extend the scaffolded
[`write/observation_from_extraction.php`](../../../../../interface/modules/custom_modules/oe-module-agentforge/public/write/observation_from_extraction.php)
to INSERT into the procedure_* chain + point the dashboard at the
stock FHIR endpoint. Implementation runbook in the journal's Next Steps.
