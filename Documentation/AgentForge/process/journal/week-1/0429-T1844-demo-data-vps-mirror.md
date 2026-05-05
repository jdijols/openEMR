---
date: 2026-04-29
topic: Future appointment seeding, demo patient ID polish, and VPS database mirror
related_milestone: process/milestones/week-1/09-vps-live-deployment.md
---

# Demo data + VPS mirror — session journal

## Goal

Finish the AgentForge demo data layer so the public OpenEMR instance shows a realistic primary-care day: deep cohort charts, future appointments across three physicians, consistent patient demographics, and a VPS database that mirrors the local environment. User framing: "show the user journey, which is a primary care physician working through many appointments in a given day" and later "the easiest way for us to get how my local environment looks right now ... imported over to the deployed VPS version."

## Context

The prior session created the longitudinal cohort seeder and fixed Visit Summary rendering. That left one gap: the scheduling layer in `openemr_postcalendar_events`, plus deployment of the resulting local MariaDB state to the Vultr VPS documented in [`process/milestones/week-1/09-vps-live-deployment.md`](../../milestones/week-1/09-vps-live-deployment.md).

## Key decisions

### Decision: future appointments belong in a separate seeder

- **Prompt:** "For the next seven days, show stacked appointments for all three physicians ... Think about how we would implement the writing of the database, or maybe injecting this data via script."
- **Recommendation:** Keep encounter history and future scheduling separate. Add `contrib/util/agentforge/seed_appointments.php` to write `openemr_postcalendar_events` through `AppointmentService`, while leaving `seed_cohort.php` responsible for longitudinal chart history.
- **Outcome:** [`contrib/util/agentforge/seed_appointments.php`](../../../../../contrib/util/agentforge/seed_appointments.php) now creates weekday-only appointment blocks for Donna Lee, Fred Stone, and Billy Smith, and generates [`Documentation/AgentForge/cohort/appointments.md`](../../../cohort/appointments.md).

### Decision: appointment population uses stock + cohort + new scheduled patients

- **Prompt:** "We could also use the three original patients ... We could also create potentially new patients that have no previous data and are essentially coming to the physicians for the first time."
- **Recommendation:** Use all three patient sources so the calendar looks like a real primary-care schedule: stock demo patients, the 10 AgentForge cohort patients, and lightweight first-visit patients.
- **Outcome:** The schedule creates 15 appointment-only patients tagged internally with `AgentForge Scheduled Patient ID`, while preserving cleanup safety via `AF-SCHEDULED-*` markers.

### Decision: demo-facing External IDs should be zero-padded

- **Prompt:** "Can we do four-digit formatting for all of them? For example, Phil Belford ... will change to 0001."
- **Recommendation:** Decouple display identifiers from internal cleanup markers. Use `pubpid` values `0001` through `0028` for all demo patients so Finder sorting is stable, while retaining `genericval1` markers such as `AF-COHORT-*` and `AF-SCHEDULED-*`.
- **Outcome:** Stock patients are normalized to `0001`-`0003`, cohort patients to `0004`-`0013`, and scheduled patients to `0014`-`0028` in both seed scripts.

### Decision: normalize stock patient demographics in both seed paths

- **Prompt:** "Can we update the phone number and social of the three stock patients ... so that their home phone number, Social Security, and also date of birth are aligned with the rest of our patients?"
- **Recommendation:** Add the same stock-patient normalization pass to both `seed_cohort.php` and `seed_appointments.php` so either path repairs the bundled demo rows after a reset.
- **Outcome:** Phil Belford, Susan Underwood, and Wanda Moore now get consistent `(619) 555-000x` phones, `900-45-000x` SSNs, preserved DOBs, and padded External IDs.

### Decision: mirror local to VPS with DB dump/restore

- **Prompt:** "What is the easiest way for us to get how my local environment looks right now ... imported over to the deployed VPS version?"
- **Recommendation:** Use a full MariaDB dump/restore, not re-running seed scripts on the VPS. This preserves the exact local patient rows, appointments, encounters, UUIDs, and timestamps rather than recreating a near-equivalent dataset.
- **Outcome:** Created plan `vps_db_mirror_05d672f4`, took a VPS backup, exported local `openemr`, copied the dump to the VPS, restored it over the VPS DB, synced the changed app files, and verified the public IPv4 URL.

## Trade-offs and alternatives

- **Re-run seed scripts on the VPS** — Rejected for the mirror operation. It is a good recovery path after a future reset, but not an exact copy of the local state.
- **Commit/push then pull from GitLab before restore** — Deferred. Direct `scp` of the changed files was sufficient for this demo sync; the working tree remains uncommitted.
- **Use the direct IPv6 public URL** — Not used as the verified demo URL because local curl returned an empty 500 through IPv6. The VPS app was healthy locally and public IPv4 worked.

## Tools, dependencies, commands

No new dependencies were installed. Key commands and operations:

```bash
# Seed locally
docker compose -f docker/development-easy/docker-compose.yml exec openemr php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_cohort.php
docker compose -f docker/development-easy/docker-compose.yml exec openemr php /var/www/localhost/htdocs/openemr/contrib/util/agentforge/seed_appointments.php

# Export local DB
docker compose -f docker/development-easy/docker-compose.yml exec -T mysql mariadb-dump -uroot -proot --single-transaction --routines --triggers --events openemr | gzip -9 > /tmp/openemr-db-mirror/local-openemr-20260429-183503.sql.gz

# VPS backup + restore shape
ssh root@2001:19f0:0:3e4c:5400:6ff:fe1e:4c8b
scp /tmp/openemr-db-mirror/local-openemr-20260429-183503.sql.gz root@[2001:19f0:0:3e4c:5400:6ff:fe1e:4c8b]:/opt/openemr-db-mirror/
```

VPS safety backup created at:

```text
/opt/openemr-db-mirror/vps-before-mirror-20260429-233444.sql.gz
```

## Files touched

- **Created:** `contrib/util/agentforge/seed_appointments.php`
- **Created:** `Documentation/AgentForge/cohort/appointments.md`
- **Created:** `Documentation/AgentForge/process/journal/week-1/0429-T1844-demo-data-vps-mirror.md`
- **Previously created this workstream:** `contrib/util/agentforge/seed_cohort.php`
- **Previously created this workstream:** `Documentation/AgentForge/cohort/roster.md`
- **Previously created this workstream:** `Documentation/AgentForge/process/journal/week-1/0429-T1744-cohort-seed-and-visit-summary-fix.md`
- **Modified:** `contrib/util/agentforge/seed_cohort.php`
- **Modified:** `contrib/util/agentforge/seed_appointments.php`
- **Modified:** `Documentation/AgentForge/cohort/roster.md`
- **Modified:** `Documentation/AgentForge/cohort/appointments.md`
- **Modified:** `interface/forms/newpatient/report.php`

## Outcomes

The local and VPS demo databases now have 28 patients sorted by External ID `0001` through `0028`, 10 deep cohort patients, 15 scheduled first-visit patients, and 166 weekday appointment rows across the three providers. VPS verification passed for public IPv4 login, Finder, patient chart `0004`, Visit Summary rendering, and calendar data counts.

## Next steps

- [ ] Commit the data-seeding scripts, generated manifests, and Visit Summary fix in a sensible set of commits.
- [ ] Decide whether to add a numbered `process/10-...` milestone for demo-data seeding now that it has graduated from journal artifact to deployment dependency.
- [ ] Re-check VPS firewall exposure for `8310` and `8320`; the milestone already warns not to expose DB/phpMyAdmin publicly.
- [ ] Use the VPS backup path above if rollback is needed before further deployment work.

## Links

- Numbered milestone: [`process/milestones/week-1/09-vps-live-deployment.md`](../../milestones/week-1/09-vps-live-deployment.md)
- Related journal: [`0429-T1744-cohort-seed-and-visit-summary-fix.md`](0429-T1744-cohort-seed-and-visit-summary-fix.md)
- Generated cohort manifest: [`Documentation/AgentForge/cohort/roster.md`](../../../cohort/roster.md)
- Generated appointment manifest: [`Documentation/AgentForge/cohort/appointments.md`](../../../cohort/appointments.md)
