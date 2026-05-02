import { describe, expect, it } from 'vitest';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('observability', () => {
  it('with client=null, traceTurn resolves and correlationId propagates', async () => {
    const env = testEnv();
    const obs = createObservability(env, { client: null });
    await expect(obs.traceTurn({ correlationId: 'corr-abc' })).resolves.toEqual({
      id: 'corr-abc',
      correlationId: 'corr-abc',
    });
  });

  it('with client=null, recordToolCall returns a no-op span', async () => {
    const env = testEnv();
    const obs = createObservability(env, { client: null });
    const span = await obs.recordToolCall({ correlationId: 'corr-x', toolName: 'noop' });
    await expect(span.end()).resolves.toBeUndefined();
  });

  it('with client=null, recordEvent / recordLlmCall / shutdown all resolve without throwing', async () => {
    const env = testEnv();
    const obs = createObservability(env, { client: null });
    await expect(obs.recordEvent({ correlationId: 'c', name: 'noop' })).resolves.toBeUndefined();
    await expect(
      obs.recordLlmCall({ correlationId: 'c', providerModel: 'anthropic' }),
    ).resolves.toBeUndefined();
    await expect(obs.shutdown()).resolves.toBeUndefined();
  });
});
