# Synthea-style demo fixtures (Gate 6 / G6-11)

These are **synthetic** patient summaries for storyboard / eval rehearsal — not
actual Synthea export bundles, but they preserve the same shape (deterministic
UUID, demographics, problem list, meds, allergies, last vitals) so eval cases
and the demo storyboard can refer to a stable patient lineage without coupling
to the OpenEMR demo database.

**No PHI.** Every uuid is `00000000-...`-prefixed for these fixture patients;
real demo cohorts in OpenEMR map to these by storyboard label, not uuid.

For the live demo storyboard with cohort uuids, see
[`agentforge/cui/demo-storyboard.md`](../../cui/demo-storyboard.md) (G6-14).

| Storyboard label  | Patient                             | Use case lane  |
| ----------------- | ----------------------------------- | -------------- |
| `synthea-001`     | Adult, hypertension stable          | UC-A reads     |
| `synthea-002`     | Older adult, polypharmacy           | UC-A reads     |
| `synthea-003`     | Adult, no known allergies (S8 §9.3) | UC-A negatives |
| `synthea-004`     | Adult, smoker; tobacco history      | UC-B tobacco   |
| `synthea-005`     | Adult, walk-in / chief complaint    | UC-B CC + BP   |
| `synthea-006`     | Adolescent, allergies               | UC-B allergy   |
| `synthea-007`     | Adult, normal labs                  | UC-A labs      |
| `synthea-008`     | Adult, abnormal labs                | UC-A labs      |
| `synthea-009`     | Adult, behavioral SDoH              | UC-A social    |
| `synthea-010`     | Adult, recent encounter today       | UC-B encounter |
