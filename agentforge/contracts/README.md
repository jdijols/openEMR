# AgentForge — shared HTTP path contract

Single source of truth for Context Service (`context/*`) and write (`write/*`) script paths under `oe-module-agentforge/public/`.

PHP anchors: `OpenEMR\Modules\AgentForge\Http\Read*` / `Write*` classes expose `RELATIVE_SCRIPT_PATH` per path in `module-http-paths.json`.

TypeScript: `agentforge/api/src/openemr/types.ts` imports this JSON — do not duplicate paths manually.
