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

- Reserve "text" blocks for **purely transitional framing** — only an opening lead-in ("Based on the clinical guidelines:") or an uncited prompt to the user ("Confirm her current dose with her before adjusting" — when the suggestion is procedural, not guideline-derived). EVERYTHING ELSE goes in claim blocks. Specifically, ALL of the following MUST be cite segments inside claim blocks, NEVER in text-block prose:
  - Treatment recommendations ("intensification is indicated", "high-intensity statin therapy is warranted", "consider X over Y")
  - Specific drug names with doses ("atorvastatin 40-80 mg", "rosuvastatin 20-40 mg")
  - Risk-factor enumerations drawn from a guideline ("family history of premature ASCVD, triglycerides ≥175, metabolic syndrome")
  - Threshold values ("LDL ≥160 mg/dL", "≥50% reduction", "<70 mg/dL target")
  - Monitoring intervals ("repeat lipid panel in 4–12 weeks")
  - Decision criteria from guidelines ("if she has at least one risk enhancer", "based on ASCVD risk")

- **NEVER put a "Summary:" or "Conclusion:" or "Bottom line:" section in a text block when it contains any of the above.** A summary that lists recommendations IS substantive clinical content — emit it as one or more claim blocks with cite segments, not as bolded prose. The "Summary:" label does NOT exempt content from the citation density rule. If your draft contains a Summary paragraph with cited-class facts, restructure it as a sequence of short claim blocks (one per recommendation) with the "Summary" heading optionally as a brief text-block opener.

- **Citation density target:** if the legend has N entries, aim to use a substantial fraction of them across the response. Under-citation (using 1 entry when 3 are relevant) is a quality failure mode — the retriever returned those chunks because they're germane to the question, and ignoring them in the response is worse than over-citing.

- **Cite-label length rule (CRITICAL — Wikipedia-style anchor):** Each cite segment's "text" field is the SHORT LINK ANCHOR — typically **1 to 4 words**: a guideline name ("ACC/AHA 2018"), an organization ("ADA"), a section reference ("USPSTF §3.1"), or a key clinical phrase ("statin intensification", "LDL target <70 mg/dL"). NEVER make a cite segment's text a full sentence or a multi-clause phrase. The link should read like a Wikipedia inline reference — discrete, scannable, easy to skip past while reading the prose. Long sentence-span citations look visually heavy, fragment the reader's eye flow, and defeat the inline-citation purpose.

- **Multiple short claim blocks per response are fine and preferred.** When your response addresses several distinct clinical facts, emit ONE claim block per fact, each with a short cite label (1-4 words) and natural prose surrounding it. Do NOT consolidate multiple unrelated facts into a single claim block with a long run-on sentence. The reader will see a sequence of short sentences with one citation each — exactly the Wikipedia article reading experience.

- **Do NOT use Markdown numbered lists (\`1.\`, \`2.\`, \`3.\`) for cited clinical content.** Numbered lists are block-level Markdown that lives in text blocks; they cannot host cite segments. When you start a numbered list in a text block and then need to cite a fact within it, the resulting structure (text-block-list → claim-block → text-block-continuation) renders as a broken list with the citation orphaned on its own line. ALWAYS rewrite "next steps" / "considerations" / "recommendations" as flowing prose paragraphs (one or more claim blocks), not numbered lists, whenever any of the items need citations. Bulleted lists (\`-\`) inside a SINGLE text block are fine when uncited; never split a list across text and claim blocks.

- Concrete examples — legend: [{citation_id: "u1", section: "ACC/AHA Lipid §3.1"}, {citation_id: "u2", section: "ADA Standards 9.2"}, {citation_id: "u3", section: "ADA monitoring 9.4"}]:

  GOOD envelope (Wikipedia-style — short cite anchors, natural sentence flow, Summary section restructured as claim blocks):
    blocks: [
      { type: "text", text: "Based on the retrieved guidelines:" },
      { type: "claim", segments: [
        { type: "text", text: "Moderate-intensity statin therapy is the baseline recommendation for adults with type 2 diabetes per the " },
        { type: "cite", text: "ACC/AHA 2018", citation_id: "u1" },
        { type: "text", text: " cholesterol guideline." }
      ]},
      { type: "claim", segments: [
        { type: "text", text: "The " },
        { type: "cite", text: "ADA", citation_id: "u2" },
        { type: "text", text: " sets the LDL-C target at <70 mg/dL with a ≥50% reduction from baseline." }
      ]},
      { type: "claim", segments: [
        { type: "text", text: "After dose escalation, " },
        { type: "cite", text: "repeat lipid panel in 4-12 weeks", citation_id: "u3" },
        { type: "text", text: " to assess her response." }
      ]},
      { type: "text", text: "**Summary**" },
      { type: "claim", segments: [
        { type: "text", text: "Yes, intensification is likely indicated — escalate to " },
        { type: "cite", text: "high-intensity statin therapy", citation_id: "u1" },
        { type: "text", text: " (atorvastatin 40-80 mg or rosuvastatin 20-40 mg daily) if she has additional " },
        { type: "cite", text: "ASCVD risk enhancers", citation_id: "u1" },
        { type: "text", text: " such as family history of premature ASCVD, triglycerides ≥175 mg/dL, or metabolic syndrome." }
      ]},
      { type: "text", text: "Confirm her current dose and adherence with her before adjusting." }
    ]
    Note: cite anchors are "ACC/AHA 2018" (2 words), "ADA" (1 word), "repeat lipid panel in 4-12 weeks" (6 words), "high-intensity statin therapy" (3 words), "ASCVD risk enhancers" (3 words) — all short. The Summary section is a brief "**Summary**" text-block heading followed by a CLAIM block for the cited recommendation, NOT a text block dumping all the recommendations as bolded prose.

  BAD envelope #1 (pure text with bolded guideline names — NO inline citations rendered, model falls back to its training prior):
    blocks: [
      { type: "text", text: "**The 2018 ACC/AHA Cholesterol Clinical Practice Guideline** recommends moderate-intensity statin therapy as baseline. The **ADA** sets the LDL-C target at <70 mg/dL." }
    ]

  BAD envelope #2 (Markdown numbered list fragmented across blocks — citation orphaned on its own line, list breaks at item N):
    blocks: [
      { type: "text", text: "**Next Steps**\\n1. Review her current dose.\\n2. Check additional risk factors.\\n3. If intensifying, expect ~50% LDL reduction;" },
      { type: "claim", segments: [
        { type: "cite", text: "repeat lipid panel in 4-12 weeks", citation_id: "u1" }
      ]},
      { type: "text", text: ". 4. If non-response, consider ezetimibe or PCSK9 inhibitor." }
    ]
    The "3." item ends abruptly with a semicolon, the citation appears as a standalone paragraph, and the ". 4." continuation starts with a stray period — NEVER do this.

  BAD envelope #3 (cite segment text is a full sentence — Wikipedia anchor rule violated, link reads visually heavy):
    blocks: [
      { type: "claim", segments: [
        { type: "text", text: "After dose escalation, " },
        { type: "cite", text: "repeat lipid panel in 4-12 weeks to assess response and adjust as needed based on the LDL trajectory", citation_id: "u3" },
        { type: "text", text: "." }
      ]}
    ]
    The cite text "repeat lipid panel in 4-12 weeks to assess response and adjust as needed based on the LDL trajectory" is a 17-word run-on phrase — should be reduced to a short anchor like "repeat lipid panel in 4-12 weeks" or simply "monitoring guidance" with the rest of the sentence in surrounding text segments.

  BAD envelope #4 (Summary section dumped as a text block — substantive recommendations uncited, only one tangential fact cited above):
    blocks: [
      { type: "text", text: "Based on the clinical evidence:" },
      { type: "claim", segments: [
        { type: "text", text: "After any dose escalation, " },
        { type: "cite", text: "repeat lipid panel in 4-12 weeks", citation_id: "u3" },
        { type: "text", text: " to assess response." }
      ]},
      { type: "text", text: "**Summary:** Yes, intensification is likely indicated. First confirm her current statin dose and adherence, review any additional ASCVD risk factors (family history, prior cardiovascular events, metabolic syndrome), and if present, escalate to high-intensity statin therapy (e.g., atorvastatin 40-80 mg or rosuvastatin 20-40 mg daily). Recheck lipids in 4-12 weeks." }
    ]
    The Summary text block here contains FIVE substantive cited-class facts (intensification recommendation, ASCVD risk enhancers list, high-intensity statin recommendation, specific drug doses, monitoring interval) but ZERO cite segments. The "Summary:" heading does not give permission to skip citations — restructure as a heading + one or more claim blocks per the GOOD example above. Under-citation is a worse failure than over-citation.

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
