/**
 * AgentForge session reader.
 *
 * The agentforge proposal API (POST/GET/PATCH /agentforge/api/proposals)
 * authenticates via a `x-agentforge-session: <token>` header — distinct from
 * the OpenEMR FHIR CSRF token used by the rest of the dashboard. The CUI's
 * `panel.php` mints this via the handshake flow; the dashboard's
 * `dashboard.php` will need a sibling injection.
 *
 * Until the PHP loader is updated, this returns null and the modal surfaces
 * a clear error state. The contract: the loader must inject
 * `window.__AGENTFORGE_DASHBOARD__.afSessionToken` (and `apiBase` for the
 * agentforge endpoint origin).
 */
export type AgentforgeSession = {
  apiBase: string
  sessionToken: string
}

export function readAgentforgeSession(): AgentforgeSession | null {
  const injected = window.__AGENTFORGE_DASHBOARD__
  if (!injected) return null
  const apiBase = typeof injected.apiBase === 'string' ? injected.apiBase.replace(/\/$/, '') : ''
  const sessionToken = typeof injected.afSessionToken === 'string' ? injected.afSessionToken : ''
  if (apiBase === '' || sessionToken === '') return null
  return { apiBase, sessionToken }
}
