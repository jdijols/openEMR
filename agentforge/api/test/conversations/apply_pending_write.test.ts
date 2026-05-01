/**
 * Gate 4 G4-08 — confirm calls OpenEMR write module; rejects don’t POST.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmPendingProposal, rejectPendingProposal } from '../../src/conversations/apply_pending_write.js';
import { testEnv } from '../helpers/env-fixture.js';

const fetchPendingProposal = vi.fn();
const markProposalFinal = vi.fn();

vi.mock('../../src/conversations/store.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/conversations/store.js')>('../../src/conversations/store.js');
  return {
    ...actual,
    fetchPendingProposal: (...args: unknown[]) =>
      fetchPendingProposal(...args) as ReturnType<(typeof actual)['fetchPendingProposal']>,
    markProposalFinal: (...args: unknown[]) =>
      markProposalFinal(...args) as ReturnType<(typeof actual)['markProposalFinal']>,
  };
});

const postModuleJson = vi.fn();

vi.mock('../../src/openemr/client.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/openemr/client.js')>('../../src/openemr/client.js');
  return {
    ...actual,
    postModuleJson: (...a: Parameters<typeof actual.postModuleJson>) =>
      postModuleJson(...a) as ReturnType<typeof actual.postModuleJson>,
  };
});

const poolFake = {};

beforeEach(() => {
  fetchPendingProposal.mockReset();
  markProposalFinal.mockReset();
  postModuleJson.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('confirmPendingProposal', () => {
  it('POSTs write/chief_complaint.php and marks confirmed on accepted body', async () => {
    const env = testEnv();
    fetchPendingProposal.mockResolvedValue({
      proposalId: 'ppp-99',
      patientUuid: 'uu-8888-8888-8888-888888888888',
      encounterId: 14,
      writeTarget: 'chief_complaint',
      payload: { reason: 'Chest pain.' },
      status: 'pending' as const,
    });
    postModuleJson.mockResolvedValue({ accepted: true });
    markProposalFinal.mockResolvedValue(true);

    const out = await confirmPendingProposal(env, poolFake as never, 'ppp-99', 'uu-8888-8888-8888-888888888888', 'sess', 'c1');

    expect(out.ok).toBe(true);
    if (out.ok) expect(out.accepted).toBe(true);
    expect(postModuleJson.mock.calls.length).toBe(1);
    expect(postModuleJson.mock.calls[0]?.[1]).toBe('write/chief_complaint.php');
    expect(markProposalFinal).toHaveBeenCalledTimes(1);
  });

  it('does not call OpenEMR on patient mismatch', async () => {
    const env = testEnv();
    fetchPendingProposal.mockResolvedValue({
      proposalId: 'p-x',
      patientUuid: 'aa',
      encounterId: null,
      writeTarget: 'tobacco',
      payload: { status: 'never_smoker' },
      status: 'pending' as const,
    });

    const out = await confirmPendingProposal(env, poolFake as never, 'p-x', 'bb', 'sess', 'c');

    expect(out).toEqual({ ok: false, error: 'patient_mismatch' });
    expect(postModuleJson).not.toHaveBeenCalled();
    expect(markProposalFinal).not.toHaveBeenCalled();
  });
});

describe('rejectPendingProposal', () => {
  it('marks rejected without contacting OpenEMR', async () => {
    fetchPendingProposal.mockResolvedValue({
      proposalId: 'rej-1',
      patientUuid: 'pat-low',
      encounterId: null,
      writeTarget: 'vitals',
      payload: {},
      status: 'pending' as const,
    });
    markProposalFinal.mockResolvedValue(true);

    const out = await rejectPendingProposal(poolFake as never, 'rej-1', 'pat-low');

    expect(out.ok).toBe(true);
    expect(postModuleJson).not.toHaveBeenCalled();
    expect(markProposalFinal).toHaveBeenCalledWith(poolFake, 'rej-1', 'rejected');
  });
});
