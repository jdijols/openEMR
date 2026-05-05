-- §8 / G2-MVP-51 — RAG corpus storage for the W2 hybrid retriever.
--
-- Hosts ~25 chunks across 3 source guidelines (USPSTF screening, JNC8 BP,
-- ADA glycemic). Sparse + dense retrieval feeds Cohere Rerank → top 3-5
-- evidence snippets per query.
--
-- Indexes:
--   - HNSW on `embedding vector_cosine_ops` for sub-millisecond dense recall.
--   - GIN on the generated `text_search` tsvector for sparse FTS (
--     plainto_tsquery + ts_rank_cd).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_chunks (
  chunk_id        text PRIMARY KEY,
  section         text NOT NULL,
  text            text NOT NULL,
  source_url      text NOT NULL,
  source_type     text NOT NULL DEFAULT 'guideline_chunk',
  publication_year int,
  region          text DEFAULT 'US',
  embedding       vector(384) NOT NULL,
  text_search     tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);

CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
  ON rag_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS rag_chunks_text_search_idx
  ON rag_chunks USING gin (text_search);
