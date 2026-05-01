/**
 * Per-tab persistence layer for the auto-brief dedupe. The host rail can
 * re-mount the App iframe (pid-probe interval, refresh-chart, re-handshake);
 * an in-memory React ref alone is not enough to suppress the second brief
 * because the new mount starts with a fresh ref. Persisting a marker in
 * sessionStorage — keyed by patient_uuid, scoped to the browser tab — makes
 * "auto-fire exactly once per patient per tab" survive iframe reloads.
 */

const BRIEF_FIRED_KEY_PREFIX = 'agentforge:brief_auto_fired:';

export function briefFiredStorageKey(patientUuid: string): string {
  return `${BRIEF_FIRED_KEY_PREFIX}${patientUuid}`;
}

export function readBriefAlreadyFired(patientUuid: string): boolean {
  try {
    return window.sessionStorage.getItem(briefFiredStorageKey(patientUuid)) === '1';
  } catch {
    return false;
  }
}

export function markBriefFired(patientUuid: string): void {
  try {
    window.sessionStorage.setItem(briefFiredStorageKey(patientUuid), '1');
  } catch {
    /* sessionStorage may be unavailable (privacy mode, sandboxed iframe);
       the in-memory ref still dedupes within a single mount. */
  }
}
