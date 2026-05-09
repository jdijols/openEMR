# Patient Dashboard — Parity Notes

> **Phase 0 PD-03 output.** Decisions of the form *"the legacy does X; we will / will not match it because Y."* This is the parity contract for the React port — every entry below either commits to a behavior we'll reproduce or names a deliberate gap with rationale.
>
> Companions: [`manifest.md`](manifest.md), [`cards/`](cards/) (per-card detail), [`MIGRATION-OPTIONS.md`](MIGRATION-OPTIONS.md).

---

## 0. Visual ground truth

PD-00 captures from Sofia Reyes (`pid=0031`) live in `Documentation/AgentForge/assets/W2-Migrate-to-React-Screenshots/`. The screenshots index in [`manifest.md`](manifest.md#visual-ground-truth--screenshots-index) maps each shot to the relevant card MD. The decisions in §§1–8 below were validated against those captures.

## 1. Layout & UX decisions

| Legacy behavior | React port | Rationale |
|---|---|---|
| **Two side-by-side columns** (`col-md-8` left, `col-md-4` right) | **Single continuous scroll**, mobile-friendly column stack | The brief says *"the UX decision is yours; own both."* The OpenEMR May 2025 modernization (CapMinds writeup) promotes single-scroll + self-contained cards as the modern direction; we honor that. The two-column legacy layout was a 2010-era density compromise we don't need given modern viewport widths. |
| **Card collapse/expand state persisted per-user** via `getUserSetting('<id>_ps_expand')` | All cards always rendered open, no persistence | Stateful per-user settings need a backend round-trip we don't have time for. Cards are short — scrolling is fine. Defer to V2. |
| **Hide-card admin globals** (`hide_dashboard_cards = card_allergies, ...`) | All cards in scope always render | Admin-side configuration without an admin UI for the React port. Defer to V2. |
| **Pencil-icon edit affordance opens an edit screen** in the same window via JS routing | Pencil-icon click opens the legacy PHP edit screen **in a new tab** | Edit views are explicitly out of scope (PRD §2). Linking out keeps the round-trip discoverable without forcing us to build edit forms. |
| **`[]` expand chevron** | Removed; cards always open | Same rationale as collapse state above. |
| **Cards rendered with Bootstrap 4 `card` class + `flex-fill mx-1`** | Tailwind utility classes (`rounded-2xl border border-zinc-200 bg-white shadow-sm`, etc.) | Tailwind is our CSS architecture. Same visual end result, no Bootstrap dependency in the SPA. |
| **Patient header is a separate file** (`dashboard_header.php`) above the card grid | `<PatientHeader>` is the first sticky-top component of `<PatientDashboardPage>` | Functionally identical; different file boundary. |

## 2. Authentication & authorization decisions

| Legacy behavior | React port | Rationale |
|---|---|---|
| **Per-card ACL checks** at every render site (`AclMain::aclCheckIssue('allergy')`, `aclCheckCore('patients', 'rx')`, etc.) | **No per-card ACL re-check.** The OAuth2 access token's scopes are the read gate. | The brief says *"you are not touching the backend."* OpenEMR's FHIR endpoints already enforce ACL based on the token's scopes — re-implementing per-card ACL in React would duplicate logic and risk drift. We trust the server's gate. |
| **Session-bound auth** with PHP `$_SESSION` and CSRF tokens on every form | **Bearer-token OAuth2 with PKCE**, no cookies, no CSRF (token replaces both) | OAuth2 + PKCE is the SMART-on-FHIR-aligned pattern. Token lives in memory only (D1 invariant). |
| **Cookie-bound CSRF** on edit forms | N/A — no edit views | Edit views are out of scope; no CSRF surface. |
| **Clinician + patient-portal share login** routes via the same OpenEMR base | **Clinician-only** (D7 invariant) | Per Byron's clarification. The patient portal is a separate concern. |

## 3. Card-by-card FHIR fidelity gaps

These are fields the legacy renders that the FHIR R4 resource doesn't expose, or FHIR data we'd render that the legacy doesn't show. Surfaced during PD-02 per-card analysis.

| Card | Gap | Direction | Decision |
|---|---|---|---|
| **Allergies** | Legacy `severity_ccda` list-options (severe / life-threatening / fatal) don't map cleanly to FHIR `criticality` (`low` / `high` / `unable-to-assess`) | Legacy → FHIR loss | Render FHIR `criticality` directly; if the demo data lacks that field, fall back to `reaction[].severity`. Document the granularity loss. |
| **Allergies** | Legacy doc-block claims "critical entries pin to top" but the loop never reorders | Legacy bug | Don't reproduce the bug. Sort by `criticality` desc + `recordedDate` desc in our render. |
| **Care Team** | Legacy `physician_type_code` (SNOMED), `provider_since`, per-member `note` not standard on FHIR `CareTeam.participant` | Legacy → FHIR loss | Render `participant[].member.display` + `participant[].role[].text`. Skip the SNOMED type code and "provider since" date (V2 if useful). |
| **Vitals** | Legacy renders `BMI_status` categorical (underweight / normal / overweight / obese), `temp_method` enum (oral / axillary / etc.), pediatric percentiles (`ped_*`) | Legacy → FHIR ambiguous | OpenEMR's FHIR emission may or may not include these as `Observation` extensions. Schema-narrow + render whatever comes back; loosen schema rather than throw away data. |
| **Vitals** | FHIR `Observation?category=vital-signs&_count=10` returns 10 individual observations, not 10 vitals encounters | API shape mismatch | Fetch `_count=50`, group client-side by `effectiveDateTime` (date) into "encounters", render the latest 10 grouped rows. |
| **Demographics** | Legacy renders emergency contact (`patient_data.emergency_contact_*`), employer data, `gender_identity` separate from `sex` | Legacy → FHIR loss | Emergency contact would need `RelatedPerson?patient=:id` (separate fetch — V2). Employer is not in FHIR R4 — drop. `gender_identity` may be in `Patient.extension[]` — render if present. |
| **Appointments** | Recurring appointment fields (`pc_recurrtype` / `pc_recurrspec` / `pc_endDate`) and therapy-group categories have no FHIR R4 analog | Legacy → FHIR loss | Render single `Appointment` resources only; skip recurrence display in V1. |
| **Labs** | `procedure_report` → FHIR `Observation` is one-to-many: legacy lists one row per *report*, FHIR returns one row per *analyte* | Shape difference | Render per-analyte chronologically (this *exceeds* legacy parity — every analyte is visible with its reference range and abnormal flag). Document as a deliberate improvement. |
| **Immunizations** | Legacy SQL fetches `administered_date` but the Twig template never renders it; FHIR `Immunization` exposes `occurrenceDateTime` | Legacy bug | Render the date alongside the vaccine name. Document as a deliberate improvement. |
| **Health Concerns** | Legacy has no dedicated dashboard card — Health Concerns are in `lists` table with `type='health_concern'`, rendered by `stats.php:337` via the shared `medical_problems.html.twig` template | "Beyond parity" addition | The React port introduces a separately-named `<HealthConcernsCard>` component, sharing a single `<ConditionCard>` implementation with `<ProblemListCard>` (different `category` filter). Documented as deliberate. |

## 4. Dispatch-pattern simplifications

The legacy uses three dispatch patterns (Direct Twig, Card-class+Section, Lazy fragment) plus a meta-fragment (`stats.php`). The React port collapses all of these into one shape: every card is a self-contained `<ClinicalCard>` that renders from a `useFhirQuery` hook.

| Legacy pattern | React port |
|---|---|
| Pattern A — Direct Twig (synchronous server render) | `useFhirQuery` runs on mount, skeleton → data → empty/error states |
| Pattern B — Card class + `SectionEvent` (DI-style card registration) | Static composition in `<PatientDashboardPage>`. The legacy's extension-event hooks are out of scope (V2 if needed). |
| Pattern C — Lazy fragment (`placeHtml(...)` → fragment.php → HTML injection) | Same as Pattern A. The "lazy" semantics come for free from React's render lifecycle + TanStack Query's stale-while-revalidate. |
| Pattern C' — Meta-fragment (`stats.php` containing direct-Twig renders) | Each card mounts directly. The meta-fragment indirection is invisible to us. |

## 5. Card hiding & visibility (deferred to V2)

The legacy has three layers of visibility:

1. ACL checks → still enforced, but at the FHIR layer (we trust OAuth scopes)
2. `hide_dashboard_cards` admin global → **dropped from V1**
3. Feature globals (`disable_prescriptions`, `disable_calendar`, etc.) → **dropped from V1**

**V2 plan:** if we ship a follow-up version, expose `hide_dashboard_cards` via a `/admin/dashboard-config` endpoint (read-only — no OAuth scope to mutate it) and gate cards in the React tree. Not in V1.

## 6. Empty-state copy (parity surface)

Per acceptance criteria (PRD §5), every card has an explicit empty state — never blank. PD-00 visual capture revealed the legacy copy is **inconsistent**:

| Card | Legacy empty copy (visually confirmed) | React port copy | Source |
|---|---|---|---|
| Patient Header | (always populated; no empty state) | (no empty state) | — |
| Allergies | "None" (when card empty in dashboard) | **"No active allergies on file."** | `allergies.html.twig` |
| Medical Problems / Problem List | "Nothing Recorded" | **"No active problems on file."** | `Patient dashboard, cards expanded w: data 1.png` |
| Medications | "None" | **"No active medications."** | `medication.html.twig` |
| Prescriptions | "None" + click-through opens modal "There are currently no prescriptions." | **"No prescriptions on record."** | `Prescriptions view.png` |
| Care Team | Empty table with column headers, no rows | **"No care team members assigned."** | `Care team filled view.png` (full state) — empty would render headers + no rows |
| Vitals | (would render the loader fragment with no most-recent timestamp) | **"No vitals recorded."** | `Vitals view 1.png` |
| Demographics | (always populated; treat as Header) | (no empty state — render skeleton) | — |
| Health Concerns | "Nothing Recorded" | **"No health concerns recorded."** | `Patient dashboard, cards expanded w: data 2.png` (right column) |
| Immunizations | "None" | **"No immunizations recorded."** | `immunizations.html.twig:6` |
| Appointments | "No Recurring Appointments" (sub-section); main appointments section renders empty list | **"No upcoming appointments."** | `Patient dashboard, cards expanded w: data 2.png` (right column) |
| Labs | "No lab data documented." | **"No labs recorded."** | `Patient dashboard, cards expanded w: data 3.png` |

**Decision:** the legacy uses inconsistent copy (`None` / `Nothing Recorded` / `No lab data documented.` / `No Recurring Appointments` — four different patterns). Our React port standardizes on the clearer pattern *"No X recorded."* / *"No X on file."* / *"No X assigned."* — empty-state clarity is a graded UX dimension and one of the cheapest places to demonstrate craft. **We deliberately diverge from the legacy here** and document the divergence in the defense doc as a UX improvement.

## 7. What the React port adds beyond legacy parity

These are deliberate "above parity" decisions — small UX wins we surface in the defense doc:

1. **Single continuous scroll** layout (matching May 2025 modernization).
2. **Health Concerns as a dedicated card** (legacy only renders it via `stats.php` indirection — we surface it explicitly).
3. **Vitals dates surfaced per row** even when an individual observation lacks them (FHIR `Observation.effectiveDateTime` always present).
4. **Immunization dates surfaced per row** (legacy SQL fetches but doesn't render).
5. **Lab abnormal-value visual cue** (Tailwind warning color when `valueQuantity` is outside `referenceRange`).
6. **Skeleton loading states** rather than blank space during fetch.
7. **Typed error states** with correlation IDs (W1 pattern carried over) — never raw fetch errors.
8. **Mobile-responsive layout** — legacy is desktop-only.
9. **Severity color-coding for Allergies.** PD-00 capture (`Allergies view.png`) shows the legacy renders severity as a yellow pill regardless of value (Severe / Moderate / Mild / Unknown all yellow). Our React port colors by severity: red for `severe` / `life-threatening`, amber for `moderate`, slate for `mild`, zinc for `unknown`. Documented as deliberate.
10. **Standardized empty-state copy** — legacy uses 4 different patterns ("None" / "Nothing Recorded" / "No lab data documented." / "No Recurring Appointments"). React port unifies on *"No X recorded / on file / assigned."*

## 8. What the React port deliberately drops

These are scope cuts named here so the defense doc can be precise:

1. Edit/save round-trips on any card (V1 is read-only).
2. Hide-card admin globals.
3. Card collapse/expand state persistence.
4. Per-user card ordering preferences.
5. Recurring-appointment display.
6. Dashboard event-extension hooks (`SectionEvent`, `CardRenderEvent`, `RenderEvent`).
7. Encounter / visit summary navigation (visual elevation in Phase 7 only).
8. Any non-FHIR card (Disclosures, Amendments, Patient Reminders, Recall, Treatment/Care Preferences, Patient Portal Access, Clinical Reminders, Messages, Billing) — all require backend changes which the brief forbids.
9. Top navigation rewrite (visual elevation in Phase 7 only).
10. SDOH sub-category enrichment on Health Concerns (V2 stretch — FHIR exposes it but we don't render in V1).

---

## Summary for the defense doc

The PRD framework defense (Phase 6 PD-60) cites this file for:
- The **layout decision** (single-scroll vs. legacy 2-col) — §1
- The **auth decision** (trust OAuth scopes vs. per-card ACL) — §2
- **Feature parity gaps** with rationale — §3
- The **above-parity wins** that demonstrate taste — §7
- The **deliberate drops** that protect tier-0 — §8

Reviewers grading "feature parity with the original" will read this file as the contract. Anything not in §3, §6, §7, §8 should be implicitly assumed to match the legacy behavior; explicit drops live above.
