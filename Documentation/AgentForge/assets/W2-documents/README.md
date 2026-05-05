# W2 cohort sample documents

> **Synthetic data — not for any real workflow, real patient, or production dataset.** These files exist solely as fixtures for the AgentForge Clinical Co-Pilot Week 2 multimodal extraction demo and the eval harness. Names, MRNs, dates of birth, addresses, phone numbers, lab values, family history, and ICD/SNOMED codes are fabricated for testing purposes.

## What this is

Eight documents covering four cohort patients × two document types (intake form + outside lab report) × two file formats (typed PDF, scanned PDF, phone-photo PNG). Each patient is seeded into the local OpenEMR instance with a new-patient appointment on the demo schedule and an otherwise-empty chart, mimicking the "patient walks in, hands you a form" workflow.

## Patients and files

| Patient            | Intake form                                | Outside lab                                |
| ------------------ | ------------------------------------------ | ------------------------------------------ |
| Chen, Margaret     | `intake-forms/Chen-Margaret-Intake-Form.pdf` (typed PDF) | `lab-results/Chen-Margaret-Lab-Lipid-Panel.pdf` (lipid panel — the demo's headline document) |
| Whitaker, James    | `intake-forms/Whitaker-James-Intake-Form.pdf` (typed PDF) | `lab-results/Whitaker-James-Lab-CBC.pdf` (CBC) |
| Reyes, Sofia       | `intake-forms/Reyes-Sofia-Intake-Form.png` (phone-photo PNG) | `lab-results/Reyes-Sofia-Lab-HbA1c.png` (phone-photo PNG of HbA1c report) |
| Kowalski, Robert   | `intake-forms/Kowalski-Robert-Intake-Form.png` (phone-photo PNG) | `lab-results/Kowalski-Robert-Lab-CMP.pdf` (CMP) |

Naming convention: `{LastName}-{FirstName}-{DocumentClass}-{SubType}.{ext}` (medical-office sortable-by-patient form). See `W2_ARCHITECTURE.md` §10 for the seeding plan and `TASKS.md` G2-MVP-01..07 for the cohort prep tasks.

## Why this composition

- **Two file formats per patient** stresses the multimodal extractor: typed PDFs go through Claude's `document` content block, phone-photo PNGs through the `image` block. Both must yield Zod-validated extraction with verbatim citations.
- **Mixed PDF / PNG split across patients** ensures the cross-check path (PDF text vs. extracted facts via `pdf-parse`) is exercised for half the cohort and the bbox-overlay path is exercised for typed PDFs.
- **Chen's lipid panel** is the demo's headline: 5 results with 5/5 outside reference range (TC 232 H, HDL 48 L, LDL 158 H, TG 178 H, Non-HDL 184 H), interpretive comments referencing the 2018 ACC/AHA Cholesterol Guideline statin-intensification recommendation. Aligns with the smoke-test question "should we intensify her statin?" (see `TASKS.md` G2-MVP-99 step 9).

## Do not

- Use these files for any real clinical decision-making.
- Re-publish them outside this repo — they serve a single demo purpose here.
- Edit them. The PDFs and PNGs are referenced as-is by the eval harness; modifying bytes will invalidate fixture hashes and break extraction baselines.
