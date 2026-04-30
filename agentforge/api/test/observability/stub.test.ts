import { describe, expect, it } from 'vitest';
import { createObservability } from '../../src/observability/index.js';
import { testEnv } from '../helpers/env-fixture.js';

describe('observability', () => {
  it('Langfuse client failure does not throw from traceTurn; correlation id propagates', async () => {
    const env = testEnv();
    const obs = createObservability(env, {
      createLangfuseClient: () => {
        throw new Error('langfuse_unreachable');
      },
    });
    await expect(obs.traceTurn({ correlationId: 'corr-abc' })).resolves.toEqual({
      id: 'noop',
      correlationId: 'corr-abc',
    });
  });
});
