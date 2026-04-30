import type { Env } from './env.js';
import type { Observability } from './observability/index.js';

export type AgentForgeVariables = {
  correlationId: string;
  env: Env;
  observability: Observability;
};
