/**
 * Browser-visible Agent API base (Hono). Injected by `panel.php` via `window.__AGENTFORGE_CUI__`.
 */
export function readApiBase(): string {
  const raw = window.__AGENTFORGE_CUI__?.apiBase ?? '';
  return typeof raw === 'string' ? raw.trim().replace(/\/$/, '') : '';
}
