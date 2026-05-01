import type { Env } from './env.js';
import type { Observability } from './observability/index.js';
import type pg from 'pg';

export type AgentForgeVariables = {
  correlationId: string;
  env: Env;
  observability: Observability;
  pgPool: pg.Pool;
};
