import type { Pool } from 'pg';
import { vi } from 'vitest';

/** HTTP route tests do not need a real database; chat/orchestrator hooks are mocked separately. */
export function createStubPgPool(): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  } as unknown as Pool;
}
