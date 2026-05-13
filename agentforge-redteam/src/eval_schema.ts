/**
 * Zod schemas for adversarial eval cases and run results.
 *
 * Cases live in evals/seeds/*.json. Runs are emitted to evals/results/.
 * Both shapes are versioned by `schema_version` so future migrations stay
 * traceable in the ledger.
 */
import { z } from 'zod';

export const SCHEMA_VERSION = '2026-05-12-mvp' as const;

const PrioritySchema = z.enum(['P0', 'P1', 'P2']);
const SeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
const VerdictSchema = z.enum(['pass', 'fail', 'partial', 'error']);

const JudgeRuleSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('refusal_required'),
    refusal_patterns: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal('forbidden_substring'),
    forbidden: z.array(z.string()).min(1),
    case_insensitive: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('forbidden_pattern'),
    patterns: z.array(z.string()).min(1),
  }),
  z.object({
    kind: z.literal('forbidden_substring_or_refusal'),
    forbidden: z.array(z.string()).min(1),
    refusal_patterns: z.array(z.string()).min(1),
    case_insensitive: z.boolean().default(true),
  }),
]);

export const EvalCaseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().min(1),
  owasp: z.array(z.string()).default([]),
  atlas: z.array(z.string()).default([]),
  priority: PrioritySchema,
  severity: SeveritySchema,
  description: z.string().min(1),
  attack: z.object({
    kind: z.enum(['chat_single_turn']),
    message: z.string().min(1),
  }),
  expected_safe_behavior: z.string().min(1),
  judge: JudgeRuleSchema,
  regression: z.boolean().default(true),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalResultSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  case_id: z.string().min(1),
  run_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  target_url: z.string().url(),
  prompt_sent: z.string(),
  response_received: z.string(),
  correlation_id: z.string().nullable(),
  verdict: VerdictSchema,
  judge_notes: z.string(),
  severity_observed: SeveritySchema.nullable(),
  latency_ms: z.number().nonnegative(),
  estimated_cost_usd: z.number().nonnegative().nullable(),
  mutation_lineage: z.array(z.string()).default([]),
  error: z.string().nullable().default(null),
});

export type EvalResult = z.infer<typeof EvalResultSchema>;

export const RunSummarySchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  run_id: z.string().uuid(),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime(),
  target_url: z.string().url(),
  total_cases: z.number().int().nonnegative(),
  by_verdict: z.record(VerdictSchema, z.number().int().nonnegative()),
  by_priority: z.record(PrioritySchema, z.number().int().nonnegative()),
  results: z.array(EvalResultSchema),
});

export type RunSummary = z.infer<typeof RunSummarySchema>;
