<?php

/**
 * G2-Final-FB-C-02 — public status page.
 *
 * Static HTML that fetches `<api>/status` client-side and renders three
 * pills (API, Postgres, Langfuse) plus the deployed version + last-seen
 * timestamp. No auth required — first thing a reviewer can hit after the
 * deploy lands to verify health. PHI-safe by design (the status payload
 * carries only pill states + version + ISO timestamp).
 *
 * The agentforge-api base URL is rendered via the existing
 * `agentforge_common.php` config helper so the page works regardless of
 * dev/prod hostname.
 *
 * @package   OpenEMR
 * @link      https://www.open-emr.org
 * @copyright Copyright (c) 2026 OpenCoreEMR Inc <https://opencoreemr.com/>
 * @license   https://github.com/openemr/openemr/blob/master/LICENSE GNU General Public License 3
 */

declare(strict_types=1);

require_once __DIR__ . '/../agentforge_common.php';

agentforge_require_globals(ignoreAuthForRequest: true);

$apiBaseRaw = \getenv('AGENTFORGE_API_PUBLIC_URL');
$apiBase = is_string($apiBaseRaw) && $apiBaseRaw !== '' ? rtrim($apiBaseRaw, '/') : '';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentForge — Deploy Status</title>
<style>
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 2rem; background: #f8f9fa; color: #222; }
  .wrap { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin: 0 0 1.5rem 0; }
  .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-weight: 600; font-size: 0.85rem; margin-right: 8px; margin-bottom: 8px; }
  .pill--green { background: rgba(29,131,72,0.12); color: #1d8348; border: 1px solid rgba(29,131,72,0.4); }
  .pill--yellow { background: rgba(243,156,18,0.12); color: #b9770e; border: 1px solid rgba(243,156,18,0.4); }
  .pill--red { background: rgba(192,57,43,0.12); color: #c0392b; border: 1px solid rgba(192,57,43,0.4); }
  .pill--unconfigured { background: rgba(127,140,141,0.12); color: #555; border: 1px solid rgba(127,140,141,0.4); }
  .pill--unknown { background: rgba(0,0,0,0.05); color: #666; border: 1px solid rgba(0,0,0,0.15); }
  .meta { margin-top: 1rem; font-size: 0.85rem; color: #555; }
  .err { color: #c0392b; }
  code { background: rgba(0,0,0,0.05); padding: 1px 4px; border-radius: 3px; font-size: 0.85em; }
</style>
</head>
<body>
<div class="wrap">
  <h1>AgentForge — Deploy Status</h1>
  <p>Health pills below are fetched live from <code><?php echo htmlspecialchars($apiBase, ENT_QUOTES); ?>/status</code>. No auth required.</p>
  <div id="pills" data-testid="status-pills">
    <span class="pill pill--unknown">API ?</span>
    <span class="pill pill--unknown">Postgres ?</span>
    <span class="pill pill--unknown">OpenEMR module ?</span>
    <span class="pill pill--unknown">Langfuse ?</span>
  </div>
  <p class="meta" id="meta">Loading…</p>
</div>
<script>
(function () {
  var apiBase = <?php echo json_encode($apiBase); ?>;
  var pills = document.getElementById('pills');
  var meta = document.getElementById('meta');

  function pillHtml(label, variant) {
    var safe = String(label).replace(/[<>&"']/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c];
    });
    return '<span class="pill pill--' + variant + '">' + safe + '</span>';
  }

  fetch(apiBase + '/status', { method: 'GET' })
    .then(function (res) {
      if (!res.ok) {
        throw new Error('http_' + res.status);
      }
      return res.json();
    })
    .then(function (body) {
      var html = '';
      html += pillHtml('API ' + glyph(body.api), body.api);
      html += pillHtml('Postgres ' + glyph(body.postgres), body.postgres);
      html += pillHtml('OpenEMR module ' + glyph(body.openemr_module), body.openemr_module);
      html += pillHtml('Langfuse ' + glyph(body.langfuse), body.langfuse);
      pills.innerHTML = html;
      meta.textContent = 'version ' + (body.version || 'unknown') + ' · last seen ' + (body.last_seen || 'unknown');
    })
    .catch(function (err) {
      meta.className = 'meta err';
      meta.textContent = 'Failed to reach ' + apiBase + '/status — ' + (err && err.message ? err.message : 'network_error');
    });

  function glyph(v) {
    if (v === 'green') return '✓';
    if (v === 'yellow') return '!';
    if (v === 'red') return '✗';
    if (v === 'unconfigured') return '–';
    return '?';
  }
})();
</script>
</body>
</html>
