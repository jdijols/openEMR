/**
 * G2-Early-26 — IntakeProposalCard fan-out dispatcher tests.
 *
 * The dispatcher fans out section data to module write endpoints. Tests stub fetch and verify:
 * (a) per-section dispatch mapping (chief_concern → write/chief_complaint.php with encounter_id, etc.)
 * (b) per-row counting + outcome aggregation
 * (c) skipped paths (chief_concern with no boundEncounterId, demographics deferred)
 * (d) network error → row marked failed, dispatch continues for remaining sections
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { dispatchIntakeConfirm, type IntakeDispatchEnv } from './intake_dispatch.js';
import type { IntakeProposalData } from './IntakeProposalCard.js';

const FULL_DATA: IntakeProposalData = {
  demographics: {
    legal_name_first: 'Margaret',
    legal_name_last: 'Chen',
    legal_name_middle: 'L.',
    dob: '1967-08-14',
    sex: 'Female',
    contact_phone: '(510) 555-0148',
  },
  chief_concern: { text: 'Tired during the day', onset: '~3 weeks' },
  current_medications: [
    { name: 'Lisinopril', dose: '10 mg', frequency: 'PO daily' },
    { name: 'Metformin', dose: '500 mg', frequency: 'PO BID' },
  ],
  allergies: [{ substance: 'Penicillin', reaction: 'Hives', severity: 'moderate' }],
  family_history: [{ relation: 'mother', condition: 'Type 2 diabetes' }],
};

const ENV: IntakeDispatchEnv = {
  moduleBase: 'https://localhost/interface/modules/custom_modules/oe-module-agentforge/public',
  sessionToken: 'test-session-token',
  patientUuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  boundEncounterId: 12345,
};

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchAccept(): { calls: Array<{ url: string; body: unknown }> } {
  const calls: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : String(url);
    let body: unknown = null;
    if (init?.body !== undefined && typeof init.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    calls.push({ url: u, body });
    return new Response(
      JSON.stringify({ accepted: true, audit_row_id: 0, correlation_id: 'corr-x' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
  return { calls };
}

function mockFetchAlwaysReject(reason: string): void {
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({ accepted: false, reason, correlation_id: 'corr-x' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof globalThis.fetch;
}

describe('§9 G2-Early-26 — dispatchIntakeConfirm', () => {
  it('fans out one POST per row across the 5 mapped sections', async () => {
    const { calls } = mockFetchAccept();
    const outcome = await dispatchIntakeConfirm(ENV, FULL_DATA);

    // 1 chief_concern + 2 medications + 1 allergy + 1 family + 1 demographics = 6.
    expect(outcome.totalAttempted).toBe(6);
    expect(outcome.totalSucceeded).toBe(6);
    expect(calls).toHaveLength(6);
  });

  it('chief_concern POST carries the encounter_id', async () => {
    const { calls } = mockFetchAccept();
    await dispatchIntakeConfirm(ENV, FULL_DATA);
    const ccCall = calls.find((c) => c.url.endsWith('write/chief_complaint.php'));
    expect(ccCall).toBeDefined();
    const body = ccCall!.body as { encounter_id?: number; payload?: { reason?: string } };
    expect(body.encounter_id).toBe(12345);
    expect(body.payload?.reason).toBe('Tired during the day');
  });

  it('medication POST carries name + dose + frequency, no encounter_id', async () => {
    const { calls } = mockFetchAccept();
    await dispatchIntakeConfirm(ENV, FULL_DATA);
    const medCalls = calls.filter((c) => c.url.endsWith('write/medication_add.php'));
    expect(medCalls).toHaveLength(2);
    const first = medCalls[0]!.body as {
      encounter_id?: number;
      payload: { name: string; dose: string; frequency: string };
    };
    expect(first.encounter_id).toBeUndefined();
    expect(first.payload.name).toBe('Lisinopril');
    expect(first.payload.dose).toBe('10 mg');
    expect(first.payload.frequency).toBe('PO daily');
  });

  it('family_history POST carries lowercased relation + condition', async () => {
    const { calls } = mockFetchAccept();
    await dispatchIntakeConfirm(
      ENV,
      { ...FULL_DATA, family_history: [{ relation: 'Mother', condition: 'T2DM' }] },
    );
    const fhCall = calls.find((c) => c.url.endsWith('write/family_history_add.php'));
    expect(fhCall).toBeDefined();
    const body = fhCall!.body as { payload: { relation: string; condition: string } };
    expect(body.payload.relation).toBe('mother');
    expect(body.payload.condition).toBe('T2DM');
  });

  it('demographics POSTs to write/demographics_update.php with mapped field names', async () => {
    const { calls } = mockFetchAccept();
    const outcome = await dispatchIntakeConfirm(ENV, FULL_DATA);
    const demoCall = calls.find((c) => c.url.endsWith('write/demographics_update.php'));
    expect(demoCall).toBeDefined();
    const body = demoCall!.body as { payload: Record<string, unknown> };
    expect(body.payload['first_name']).toBe('Margaret');
    expect(body.payload['last_name']).toBe('Chen');
    expect(body.payload['dob']).toBe('1967-08-14');
    expect(body.payload['sex']).toBe('Female');
    const demoSection = outcome.sections.find((s) => s.section === 'demographics');
    expect(demoSection?.skippedReason).toBeUndefined();
    expect(demoSection?.attempted).toBe(1);
  });

  it('chief_concern is skipped when no boundEncounterId', async () => {
    const { calls } = mockFetchAccept();
    const outcome = await dispatchIntakeConfirm({ ...ENV, boundEncounterId: null }, FULL_DATA);
    expect(calls.find((c) => c.url.endsWith('write/chief_complaint.php'))).toBeUndefined();
    const cc = outcome.sections.find((s) => s.section === 'chief_concern');
    expect(cc?.skippedReason).toBe('No bound encounter');
  });

  it('rejected row is counted in attempted but not in succeeded; partial outcome surfaces', async () => {
    mockFetchAlwaysReject('write failed');
    const outcome = await dispatchIntakeConfirm(ENV, FULL_DATA);
    expect(outcome.totalAttempted).toBe(6);
    expect(outcome.totalSucceeded).toBe(0);
    const allergiesSection = outcome.sections.find((s) => s.section === 'allergies');
    expect(allergiesSection!.attempted).toBe(1);
    expect(allergiesSection!.succeeded).toBe(0);
    const row = allergiesSection!.rows[0]!;
    expect(row.ok).toBe(false);
    if (!row.ok) {
      expect(row.reason).toBe('write failed');
    }
  });
});
