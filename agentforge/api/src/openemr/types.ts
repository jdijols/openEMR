import { z } from 'zod';
import moduleHttpPaths from '../../../contracts/module-http-paths.json' with { type: 'json' };

export const MODULE_HTTP_PATHS: readonly string[] = moduleHttpPaths.paths;

/** Gate 2+ — Zod shapes for OpenEMR module JSON mirror these paths via the typed client. */
export type ModuleHttpPath = (typeof MODULE_HTTP_PATHS)[number];

export const sourcePackSchema = z.object({
  resource_family: z.string(),
  table: z.string(),
  row_id: z.number(),
  uuid: z.string(),
  as_of: z.string(),
  retrieval_path: z.string(),
  navigation_hint: z.object({
    kind: z.string(),
    params: z.record(z.string(), z.unknown()),
  }),
});

export type SourcePack = z.infer<typeof sourcePackSchema>;

const contextEnvelopeSchema = z.object({
  ok: z.literal(true),
  correlation_id: z.string().optional(),
});

export type IdentityDataRow = Record<string, unknown> & { source_pack: SourcePack };

export const identityResponseSchema = contextEnvelopeSchema.extend({
  data: z.intersection(
    z.record(z.string(), z.unknown()),
    z.object({ source_pack: sourcePackSchema }),
  ),
}).transform((v) => ({
  ok: true as const,
  correlation_id: v.correlation_id,
  data: v.data as IdentityDataRow,
}));

export const allergyRowSchema = z.object({
  substance: z.string(),
  reaction: z.string(),
  severity: z.string(),
  status: z.string(),
  source_pack: sourcePackSchema,
});

export type AllergyRow = z.infer<typeof allergyRowSchema>;

export const allergiesResponseSchema = contextEnvelopeSchema.extend({
  data: z.array(allergyRowSchema),
}).transform((v) => ({
  ok: true as const,
  correlation_id: v.correlation_id,
  data: v.data,
}));

/** Gate 3 — arbitrary row objects that must carry a validated source_pack per §4.5. */
export const contextualRowWithPackSchema = z
  .object({ source_pack: sourcePackSchema })
  .passthrough();

export type ContextRow = z.infer<typeof contextualRowWithPackSchema>;

export const chartContextRowsResponseSchema = contextEnvelopeSchema.extend({
  data: z.array(contextualRowWithPackSchema),
}).transform((v) => ({
  ok: true as const,
  correlation_id: v.correlation_id,
  data: v.data as ContextRow[],
}));

export type CallCtx = {
  sessionToken: string;
  patientUuid: string;
  correlationId: string;
};

export const claimSegmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('cite'), text: z.string(), citation_id: z.string().min(1) }),
]);

export type ClaimSegment = z.infer<typeof claimSegmentSchema>;

const claimBlockSchema = z
  .object({
    type: z.literal('claim'),
    text: z.string().optional(),
    citation_ids: z.array(z.string()).optional(),
    segments: z.array(claimSegmentSchema).optional(),
  })
  .superRefine((val, ctx) => {
    const hasSeg = val.segments !== undefined && val.segments.length > 0;
    const hasText = val.text !== undefined && val.text.trim() !== '';
    if (!hasSeg && !hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'claim requires non-empty text or segments',
      });
    }
    if (hasSeg && hasText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'claim must not mix text and segments',
      });
    }
    if (hasSeg) {
      const citeCount = val.segments!.filter((s) => s.type === 'cite').length;
      if (citeCount < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['segments'],
          message: 'claim with segments must include at least one cite segment',
        });
      }
    }
  });

export const chatBlockSchema = z.union([
  z.object({ type: z.literal('text'), text: z.string() }),
  claimBlockSchema,
  z.object({ type: z.literal('warning'), text: z.string() }),
  z.object({ type: z.literal('refusal'), reason: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    name: z.string(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool: z.string(),
    detail: z.string().optional(),
  }),
  z.object({
    type: z.literal('proposal'),
    proposal_id: z.string().min(1),
    write_target: z.string().min(1),
    preview: z.string().min(1).max(4000),
  }),
]);

export type ChatBlock = z.infer<typeof chatBlockSchema>;
