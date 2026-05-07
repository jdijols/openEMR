/**
 * Zod schema for the structured-output finalization step (P0-B).
 *
 * The orchestrator's first LLM call (`generateText` with tools) gathers
 * evidence and chart context via tool use, then writes a draft answer. The
 * draft is unconstrained — the model can emit Markdown links, prose-only
 * citations, or hallucinated guideline names. We don't trust it directly.
 *
 * The second LLM call (`generateObject`) takes the user question + the
 * citation legend (allowed citation_ids) + the draft, and produces a schema-
 * validated envelope. Because `cite.citation_id` is constrained to a
 * `z.enum([...allowed])`, the model literally cannot:
 *   - Emit a Markdown link in place of a structured citation (no `a` tag in
 *     the schema)
 *   - Cite a guideline name that wasn't retrieved (e.g., "ACC/AHA 2018"
 *     when the corpus has USPSTF/ADA only — it's not in the enum)
 *   - Skip citations entirely on a treatment-decision answer (claim blocks
 *     require ≥1 cite segment by schema refinement)
 *
 * Block kinds in the structured envelope are deliberately narrower than
 * the full `chatBlockSchema`: only `text`, `claim`, and `refusal`. Other
 * block types (`proposal`, `extraction`, `warning`) come from tool results
 * and verification, not from the model's free-text output.
 */

import { z } from 'zod';
import type { ChatBlock } from '../openemr/types.js';

/** Single citation_id available to the model on this turn. */
export type AllowedCitationIds = ReadonlySet<string>;

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().min(1).describe('Plain prose. Markdown is allowed for headings, bold, lists.'),
});

const refusalBlockSchema = z.object({
  type: z.literal('refusal'),
  reason: z
    .string()
    .min(1)
    .describe('Short machine-readable reason code (e.g., out_of_scope, missing_chart_context).'),
});

/**
 * Build the response envelope schema with citation_id constrained to the
 * allowed set. When no evidence is available (e.g., a non-clinical chat
 * turn), pass an empty set and the schema will permit text/refusal blocks
 * only — claim blocks become unconstructable because their cite segments
 * have no valid citation_ids.
 */
export function buildResponseEnvelopeSchema(allowedCitationIds: AllowedCitationIds) {
  // z.enum requires a non-empty tuple. When there are no allowed ids, we
  // make claim blocks impossible by giving cite.citation_id a never-passing
  // string check. The schema's discriminated-union forces the model to
  // emit `text` or `refusal` blocks instead.
  const citationIdSchema =
    allowedCitationIds.size > 0
      ? z.enum([...allowedCitationIds] as [string, ...string[]])
      : z.never();

  const claimSegmentSchema = z.discriminatedUnion('type', [
    z.object({
      type: z.literal('text'),
      text: z.string().min(1),
    }),
    z.object({
      type: z.literal('cite'),
      text: z.string().min(1).describe('Short visible label for the citation, e.g., "high-intensity statin therapy".'),
      citation_id: citationIdSchema.describe('MUST be one of the allowed citation_ids. Hallucinated ids are rejected.'),
    }),
  ]);

  // The "≥1 cite segment" check lives on the segments-array refinement
  // rather than `.superRefine` on the outer object, because `superRefine`
  // returns `ZodEffects` which is incompatible with `z.discriminatedUnion`'s
  // requirement that each member be a plain `ZodObject`. The validation
  // outcome is identical either way.
  const claimBlockSchema = z.object({
    type: z.literal('claim'),
    segments: z
      .array(claimSegmentSchema)
      .min(1)
      .refine((segs) => segs.some((s) => s.type === 'cite'), {
        message: 'claim blocks must include at least one cite segment',
      })
      .describe('Mix of text and cite segments forming one citable claim. Must include ≥1 cite.'),
  });

  const blockSchema = z.discriminatedUnion('type', [
    textBlockSchema,
    claimBlockSchema,
    refusalBlockSchema,
  ]);

  return z.object({
    blocks: z
      .array(blockSchema)
      .min(1)
      .describe(
        'Ordered list of blocks rendered to the clinician. Use claim blocks with segments for any clinical fact; cite from the allowed citation_ids only.',
      ),
  });
}

export type ResponseEnvelope = {
  readonly blocks: ReadonlyArray<
    | { readonly type: 'text'; readonly text: string }
    | {
        readonly type: 'claim';
        readonly segments: ReadonlyArray<
          | { readonly type: 'text'; readonly text: string }
          | { readonly type: 'cite'; readonly text: string; readonly citation_id: string }
        >;
      }
    | { readonly type: 'refusal'; readonly reason: string }
  >;
};

/**
 * Walk a claim's segments and ensure word-boundary spacing between adjacent
 * segments. The model emits segments without surrounding whitespace
 * (e.g., `[text "type 2 diabetes,"][cite "moderate-intensity statin"][text
 * "is recommended"]`) which renders as "diabetes,moderate-intensity statinis
 * recommended" — a space-loss artifact that happens because each segment is
 * its own JSON string. Pad between segments deterministically when BOTH
 * adjacent characters are non-whitespace; punctuation followed by a word
 * gets a space, repeated whitespace doesn't double up.
 */
function padSegmentBoundaries<T extends { readonly text: string }>(segments: ReadonlyArray<T>): T[] {
  const out: T[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (i === 0 || seg.text.length === 0) {
      out.push(seg);
      continue;
    }
    const prev = out[out.length - 1]!;
    const prevLast = prev.text.slice(-1);
    const curFirst = seg.text.slice(0, 1);
    const needsSpace = prevLast !== '' && curFirst !== '' && !/\s/.test(prevLast) && !/\s/.test(curFirst);
    if (!needsSpace) {
      out.push(seg);
      continue;
    }
    // Prepend space to the current segment so the cite link's clickable
    // surface still starts on the citation word, not on the leading space
    // (matters for hover/focus visuals and avoids double-underline artifacts
    // when the previous segment is also a cite).
    out.push({ ...seg, text: ` ${seg.text}` });
  }
  return out;
}

/**
 * Project a validated `ResponseEnvelope` into the orchestrator's wider
 * `ChatBlock[]` type. Safe because the envelope's block kinds are a strict
 * subset of `ChatBlock`. Applies segment whitespace padding so adjacent
 * text+cite segments don't mash together when concatenated by the renderer.
 */
export function envelopeToChatBlocks(envelope: ResponseEnvelope): ChatBlock[] {
  return envelope.blocks.map<ChatBlock>((b) => {
    if (b.type === 'text') {
      return { type: 'text', text: b.text };
    }
    if (b.type === 'refusal') {
      return { type: 'refusal', reason: b.reason };
    }
    const padded = padSegmentBoundaries(b.segments);
    return {
      type: 'claim',
      segments: padded.map((s) =>
        s.type === 'text' ? { type: 'text', text: s.text } : { type: 'cite', text: s.text, citation_id: s.citation_id },
      ),
    };
  });
}
