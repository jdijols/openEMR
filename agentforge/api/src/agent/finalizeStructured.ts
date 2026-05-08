/**
 * Structured-output finalization (P0-B) — converts the model's free-text
 * draft from the tool-using `generateText` call into a schema-validated
 * response envelope using `generateObject`.
 *
 * Why this is a separate LLM call:
 *   `generateText` allows tool use (chart_context_reads, evidence_retrieve,
 *   propose_*_write) which the model needs for context gathering. The
 *   trade-off is that its output is unconstrained — the model can emit
 *   Markdown links, prose-only citations, or hallucinated guideline names.
 *
 *   `generateObject` constrains the model to a Zod schema at decode time.
 *   Markdown links become unrepresentable; cite.citation_id is constrained
 *   to a closed enum. Two simpler, more reliable calls beat one ambitious
 *   call with a probabilistic contract.
 *
 *   Model: Anthropic Haiku via the Vercel AI SDK. The SDK uses the model's
 *   tool-calling pathway to enforce the schema (Anthropic doesn't have a
 *   native JSON-mode), which is well-supported.
 */

import { generateObject, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Observability } from '../observability/index.js';
import type { ChatBlock } from '../openemr/types.js';
import {
  buildResponseEnvelopeSchema,
  envelopeToChatBlocks,
  type AllowedCitationIds,
  type ResponseEnvelope,
} from './responseEnvelope.js';
import type { CitationLegendEntry } from './mandatoryRetrieval.js';

const FINALIZER_SYSTEM_PROMPT = `You convert a clinical assistant's draft answer into a structured response envelope for the OpenEMR clinical copilot UI.

Hard rules:
- Output MUST conform to the supplied JSON schema. The schema enforces block types and citation_id values.

- **CITATION DENSITY RULE (read carefully):** When the citation legend in the user prompt contains ANY entries (i.e., evidence was retrieved this turn), your envelope MUST include AT LEAST ONE "claim" block with cite segments referencing those legend entries. A response that uses only "text" blocks while evidence is available is INVALID — the user expects clickable inline citations to the retrieved sources, not prose-only summaries with bolded guideline names. If multiple legend entries are relevant, prefer multiple claim blocks (one per distinct fact) over consolidating everything into one mega-claim.

- **ANY guideline name, threshold value, treatment recommendation, or specific clinical figure** (e.g., "moderate-intensity statin therapy", "LDL ≥160 mg/dL", "high-intensity statin", "≥50% LDL reduction", "ACC/AHA 2018", "ADA Standards of Care") MUST be a cite segment inside a claim block — NEVER bolded prose in a text block. Bolding a guideline name in a text block is a citation failure; the ONLY correct way to surface a guideline reference is via a cite segment whose citation_id maps to a legend entry.

- For every cite segment: "text" carries the short visible label (e.g., "ACC/AHA 2018 §3.1", "high-intensity statin therapy"); "citation_id" carries the EXACT id from the allowed set. NEVER invent ids. NEVER use a markdown link in place of a cite segment.

- Reserve "text" blocks for transitional framing only — opening sentences ("Based on the clinical guidelines..."), closing or next-step suggestions ("I would also recommend confirming her current dose..."), or non-clinical context. ALL substantive clinical content goes in claim blocks.

- Concrete example, where the legend has [{citation_id: "u1", section: "ACC/AHA Lipid §3.1"}, {citation_id: "u2", section: "ADA Standards 9.2"}]:
  GOOD envelope:
    blocks: [
      { type: "text", text: "Based on the retrieved guidelines:" },
      { type: "claim", segments: [
        { type: "text", text: "The " },
        { type: "cite", text: "ACC/AHA 2018 guideline", citation_id: "u1" },
        { type: "text", text: " recommends moderate-intensity statin therapy as baseline for adults with type 2 diabetes." }
      ]},
      { type: "claim", segments: [
        { type: "text", text: "The " },
        { type: "cite", text: "ADA Standards", citation_id: "u2" },
        { type: "text", text: " set the LDL-C target at <70 mg/dL with a ≥50% reduction from baseline." }
      ]}
    ]
  BAD envelope (uses pure text with bolded guideline names — NO inline citations rendered):
    blocks: [
      { type: "text", text: "**The 2018 ACC/AHA Cholesterol Clinical Practice Guideline** recommends moderate-intensity statin therapy as baseline. The **ADA** sets the LDL-C target at <70 mg/dL." }
    ]

- If the draft refused or the question is out of scope, emit a single "refusal" block with a short machine-readable reason.
- Do not echo the citation legend or the draft itself; produce only the final envelope as the user will see it.`;

export type FinalizeStructuredInput = Readonly<{
  model: LanguageModel;
  userMessage: string;
  draftText: string;
  citationLegend: ReadonlyArray<CitationLegendEntry>;
  allowedCitationIds: AllowedCitationIds;
  observability: Observability;
  correlationId: string;
}>;

export type FinalizeStructuredResult = Readonly<{
  blocks: ChatBlock[];
  /** True when the structured call succeeded; false if we fell back. */
  structured: boolean;
}>;

/**
 * Run the structured-output finalization. On schema validation failure,
 * returns `null` so the orchestrator can fall back to the legacy parser.
 */
export async function finalizeStructuredEnvelope(
  input: FinalizeStructuredInput,
): Promise<FinalizeStructuredResult | null> {
  await input.observability.recordLlmCall({
    correlationId: input.correlationId,
    providerModel: 'finalizer',
    meta: { phase: 'structured_finalize_request' },
  });

  const schema = buildResponseEnvelopeSchema(input.allowedCitationIds);
  const userPrompt = buildFinalizerPrompt({
    userMessage: input.userMessage,
    draftText: input.draftText,
    citationLegend: input.citationLegend,
    allowedCitationIds: input.allowedCitationIds,
  });

  try {
    const result = await generateObject({
      model: input.model,
      system: FINALIZER_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema,
      // Anthropic uses tool-calling under the hood for structured output.
      // Explicitly setting mode: 'tool' is the supported path on @ai-sdk/anthropic.
      mode: 'tool',
    } as Parameters<typeof generateObject>[0]);

    // `generateObject` returns `result.object` typed by the schema.
    const envelope = result.object as ResponseEnvelope;

    // Belt-and-suspenders: re-validate. The SDK should have validated, but
    // schema-level refinements (≥1 cite segment per claim) are worth a
    // second check before we stamp this as "structured".
    const reparse = schema.safeParse(envelope);
    if (!reparse.success) {
      await input.observability.recordEvent({
        correlationId: input.correlationId,
        name: 'orchestrator.structured_finalize_invalid',
        meta: {
          phase: 'structured_finalize_response',
          outcome: 'schema_validation_failed',
          issues_count: reparse.error.issues.length,
        },
      });
      return null;
    }

    const claimBlockCount = envelope.blocks.filter((b) => b.type === 'claim').length;
    await input.observability.recordLlmCall({
      correlationId: input.correlationId,
      providerModel: 'finalizer',
      meta: {
        phase: 'structured_finalize_response',
        outcome: 'ok',
        block_count: envelope.blocks.length,
        claim_blocks: claimBlockCount,
        legend_size: input.citationLegend.length,
      },
    });

    // Defense-in-depth: if the legend was non-empty but the finalizer
    // produced zero claim blocks (model chose all-text despite the
    // citation-density rule), flag it loudly. The failure is not blocking
    // — we still return the structured blocks since they're schema-valid —
    // but the warning gives us a Langfuse signal we can grep on if the
    // rate climbs and we need to tighten the prompt further.
    if (input.citationLegend.length > 0 && claimBlockCount === 0) {
      await input.observability.recordEvent({
        correlationId: input.correlationId,
        name: 'orchestrator.structured_finalize_zero_claims',
        meta: {
          legend_size: input.citationLegend.length,
          allowed_citation_ids_size: input.allowedCitationIds.size,
          block_count: envelope.blocks.length,
          outcome: 'all_text_despite_evidence',
        },
      });
    }

    return { blocks: envelopeToChatBlocks(envelope), structured: true };
  } catch (e) {
    await input.observability.recordEvent({
      correlationId: input.correlationId,
      name: 'orchestrator.structured_finalize_exception',
      meta: {
        phase: 'structured_finalize_response',
        outcome: 'exception',
        error_message: e instanceof Error ? e.message : String(e),
      },
    });
    return null;
  }
}

function buildFinalizerPrompt(args: {
  userMessage: string;
  draftText: string;
  citationLegend: ReadonlyArray<CitationLegendEntry>;
  allowedCitationIds: AllowedCitationIds;
}): string {
  const legendBlock =
    args.citationLegend.length === 0
      ? '(no clinical evidence retrieved — emit text or refusal blocks only; claim blocks are not constructable without citations)'
      : args.citationLegend
          .map(
            (entry, i) =>
              `[${i + 1}] citation_id: ${entry.citation_id}\n     section:    ${entry.section}\n     source_url: ${entry.source_url}\n     preview:    ${entry.preview}`,
          )
          .join('\n');

  const allowedList =
    args.allowedCitationIds.size === 0
      ? '(none — claim blocks are unavailable this turn)'
      : [...args.allowedCitationIds].map((id) => `  - ${id}`).join('\n');

  return [
    `User message: ${args.userMessage}`,
    '',
    'Allowed citation_ids (closed set — any other id is invalid):',
    allowedList,
    '',
    'Citation legend (use these to cite specific facts):',
    legendBlock,
    '',
    'Draft answer to restructure:',
    '"""',
    args.draftText.trim() === '' ? '(empty draft — produce a brief refusal block explaining no answer was generated)' : args.draftText,
    '"""',
    '',
    'Produce the final response envelope conforming to the JSON schema. Cite from the allowed citation_ids only.',
  ].join('\n');
}
