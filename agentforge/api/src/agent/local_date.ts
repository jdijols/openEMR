/**
 * Facility-local "today" formatter — post-deploy P2 fix.
 *
 * Before this helper, both the chat orchestrator and the case-presentation
 * fetcher computed the model's `today` / `server_today` via
 * `new Date().toISOString().slice(0, 10)`, which is UTC. On a UTC-clock VPS,
 * an encounter saved at 8 PM Eastern was 1 AM next day UTC and the LLM
 * (correctly, given its prompt) refused to write to it because it had no
 * "today" encounter. The operator-facing symptom was the false
 * "no recent encounter for today" refusal.
 *
 * The fix is to format `today` in the operator's local clock — sourced from
 * OpenEMR's `gbl_time_zone` global, captured at handshake and round-tripped
 * via the session token (`facility_tz` claim).
 */

/**
 * `YYYY-MM-DD` for `now` in the IANA time zone `tz`. Falls back to UTC when
 * `tz` is null/empty/invalid so a missing-config install never crashes a
 * chat turn — at worst it reverts to the pre-fix behavior.
 */
export function todayInFacilityTz(now: Date, tz: string | null | undefined): string {
  const trimmed = typeof tz === 'string' ? tz.trim() : '';
  if (trimmed === '') {
    return formatYmdUtc(now);
  }

  try {
    // 'en-CA' produces ISO-style YYYY-MM-DD without locale-dependent month names.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: trimmed,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return formatYmdUtc(now);
  }
}

function formatYmdUtc(now: Date): string {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}
