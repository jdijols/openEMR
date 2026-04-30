import moduleHttpPaths from '../../../contracts/module-http-paths.json' with { type: 'json' };

export const MODULE_HTTP_PATHS: readonly string[] = moduleHttpPaths.paths;

/** Gate 2+ — Zod shapes for OpenEMR module JSON mirror these paths via the typed client. */
export type ModuleHttpPath = (typeof MODULE_HTTP_PATHS)[number];
