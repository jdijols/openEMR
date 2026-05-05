import { tool } from 'ai';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { CohereClient } from 'cohere-ai';
import type { Observability } from '../observability/index.js';
import { runEvidenceRetriever, type EvidenceRetrieverDeps } from '../workers/evidence_retriever.js';

/**
 * §8 / G2-MVP-56 — `evidence_retrieve` Vercel AI SDK tool. Supervisor calls
 * this whenever the user question references a guideline / evidence /
 * recommendation / treatment-decision context (G2-MVP-57 routing nudge).
 */

export type EvidenceRetrieveDeps = {
  readonly pool: Pool;
  readonly embedQuery: EvidenceRetrieverDeps['embedQuery'];
  readonly cohere: Pick<CohereClient, 'rerank'>;
  readonly observability: Observability;
  readonly correlationId: string;
};

const InputSchema = z.object({
  query: z.string().min(3).max(500),
  max_chunks: z.number().int().min(1).max(10).default(5),
});

export function createEvidenceRetrieveTool(deps: EvidenceRetrieveDeps) {
  return tool({
    description:
      'Search the clinical guideline corpus for evidence relevant to a clinical question. Returns up to 5 ranked snippets, each with a citation back to the source guideline section. Use whenever the user asks about recommendations, intensification, screening criteria, or other guideline-driven decisions.',
    inputSchema: InputSchema,
    execute: async ({ query, max_chunks }) => {
      const span = await deps.observability.recordToolCall({
        correlationId: deps.correlationId,
        toolName: 'evidence_retrieve',
        meta: { query_chars: query.length, max_chunks },
      });

      try {
        const chunks = await runEvidenceRetriever(
          { query, maxChunks: max_chunks },
          { pool: deps.pool, embedQuery: deps.embedQuery, cohere: deps.cohere },
        );
        await span.end({
          meta: {
            outcome: 'ok',
            chunks_returned: chunks.length,
            top_chunk_ids: chunks.map((c) => c.chunk_id),
          },
        });
        // Wrap each chunk in a W1-shaped source_pack so the verification
        // gate (`buildClinicalToolEvidence` → `verifyClinicalBlocks`)
        // accepts claim blocks that cite this chunk's chunk_id as their
        // citation_id. Without this, the gate strips all guideline-cited
        // claims and the response collapses to an
        // `insufficient_evidence_after_verification` refusal.
        const asOf = new Date().toISOString();
        const wrapped = chunks.map((c) => ({
          ...c,
          source_pack: {
            resource_family: 'clinical_guideline',
            table: 'rag_chunks',
            row_id: 0,
            uuid: c.chunk_id,
            as_of: asOf,
            retrieval_path: 'evidence_retrieve',
            navigation_hint: {
              kind: 'guideline_chunk',
              params: {
                chunk_id: c.chunk_id,
                section: c.section,
                source_url: c.source_url,
              },
            },
          },
        }));
        return { ok: true as const, chunks: wrapped };
      } catch (e) {
        // Log the underlying exception so dev tail can debug without a Langfuse round-trip.
        console.error('evidence_retrieve_threw', {
          correlation_id: deps.correlationId,
          query_chars: query.length,
          error_message: e instanceof Error ? e.message : String(e),
          error_name: e instanceof Error ? e.name : 'unknown',
          stack_head: e instanceof Error && typeof e.stack === 'string' ? e.stack.split('\n').slice(0, 5).join('\n') : null,
        });
        await span.end({ error: e });
        return { ok: false as const, error: 'evidence_retrieve_failed' as const };
      }
    },
  });
}
