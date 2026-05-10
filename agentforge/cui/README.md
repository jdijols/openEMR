Conversational UI (React + Vite). Build: `npm run build` → `dist/` for Caddy `/cui/` (Gate 6).

## Week 2 deliverables

Graders: this is the conversational iframe SPA — the conversational surface of Week 2, distinct from the W2 surprise challenge (the React patient dashboard, defended separately in [`PATIENT_DASHBOARD_MIGRATION.md`](../../PATIENT_DASHBOARD_MIGRATION.md)). The CUI's role inside W2 — citation rendering, propose/confirm UI, transcript thread — is described in [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md) at the repo root, alongside the eval suite ([`EVALUATION.md`](../../EVALUATION.md)) that gates citation and refusal behavior end-to-end. Compose setup is at [`docker/agentforge/`](../../docker/agentforge/) (extends [`docker/development-easy/`](../../docker/development-easy/)); env vars in [`docker/agentforge/secrets.env.example`](../../docker/agentforge/secrets.env.example).

## Keeping the bundle in sync with source

The OpenEMR panel iframe loads the **built** bundle from
`interface/modules/custom_modules/oe-module-agentforge/public/cui/agentforge-cui.{js,css}`,
not from the React source. So source edits don't reach the iframe until
the bundle is rebuilt. Two automations close that gap:

- **At commit time** — the `agentforge-cui-build` pre-commit hook (see
  `.pre-commit-config.yaml`) reruns `npm run build` whenever any file
  under `src/`, `index.html`, `package.json`, `package-lock.json`,
  `tsconfig.json`, or `vite.config.ts` is staged. The rebuilt bundle is
  auto-staged so the commit always contains a fresh artifact. Install
  with `prek install` (or `pre-commit install`) once per clone.

- **During dev** — run `npm run build:watch` from this directory.
  Vite rebuilds the bundle on every save, so reloading the chart in
  OpenEMR always picks up the latest source. `panel.php` cache-busts
  the URL via `?v=<filehash>`, so a normal reload is enough; no
  hard-reload tricks required.

If you bypass the hook with `git commit --no-verify`, you'll ship a
stale bundle. Don't.
