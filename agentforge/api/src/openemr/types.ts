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

export type CallCtx = {
  sessionToken: string;
  patientUuid: string;
  correlationId: string;
};

export const chatBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('claim'),
    text: z.string(),
    citation_ids: z.array(z.string()).optional(),
  }),
]);

export type ChatBlock = z.infer<typeof chatBlockSchema>;
