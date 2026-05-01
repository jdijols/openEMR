/**
 * Post-deploy P2 — facility-local "today" formatter.
 */
import { describe, expect, it } from 'vitest';
import { todayInFacilityTz } from '../../src/agent/local_date.js';

describe('todayInFacilityTz (P2 fix)', () => {
  it('formats UTC date when tz is null (preserves pre-fix behavior)', () => {
    const utc = new Date('2026-05-01T03:30:00Z');
    expect(todayInFacilityTz(utc, null)).toBe('2026-05-01');
  });

  it('formats UTC date when tz is empty string (defensive)', () => {
    const utc = new Date('2026-05-01T03:30:00Z');
    expect(todayInFacilityTz(utc, '')).toBe('2026-05-01');
  });

  it('rolls back one day in America/New_York when UTC is just past midnight (P2 reproducer)', () => {
    // 1:30 AM UTC on May 1 = 9:30 PM Eastern on April 30 — the encounter
    // saved at 9 PM Eastern is "today" for the operator but UTC says "yesterday".
    const justAfterMidnightUtc = new Date('2026-05-01T01:30:00Z');
    expect(todayInFacilityTz(justAfterMidnightUtc, 'America/New_York')).toBe('2026-04-30');
  });

  it('returns same calendar date when within the facility tz day', () => {
    const middayEastern = new Date('2026-05-01T16:00:00Z'); // 12:00 EDT
    expect(todayInFacilityTz(middayEastern, 'America/New_York')).toBe('2026-05-01');
  });

  it('handles whitespace-only tz the same as empty', () => {
    const utc = new Date('2026-05-01T03:30:00Z');
    expect(todayInFacilityTz(utc, '   ')).toBe('2026-05-01');
  });

  it('falls back to UTC silently on unknown tz string instead of throwing', () => {
    // Defensive: a typo'd `gbl_time_zone` shouldn't take down a chat turn.
    const utc = new Date('2026-05-01T03:30:00Z');
    expect(todayInFacilityTz(utc, 'Not/A_Real_Zone')).toBe('2026-05-01');
  });
});
