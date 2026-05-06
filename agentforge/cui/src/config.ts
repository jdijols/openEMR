/**
 * Browser-visible Agent API base (Hono). Injected by `panel.php` via `window.__AGENTFORGE_CUI__`.
 */
export function readApiBase(): string {
  const raw = window.__AGENTFORGE_CUI__?.apiBase ?? '';
  return typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
}

/**
 * Browser-visible OpenEMR module base (e.g. `/interface/modules/custom_modules/oe-module-agentforge/public`).
 * Used by W2 file upload + document bytes endpoints. Injected by `panel.php`.
 */
export function readModuleBase(): string {
  const raw = window.__AGENTFORGE_CUI__?.moduleBase ?? '';
  return typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
}
