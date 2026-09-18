-- Adds pgvector embeddings to Think Tank document chunks for semantic search

create extension if not exists vector;

alter table public.thinktank_document_chunks
  add column if not exists embedding vector(1536);

-- NOTE: No vector index yet. At current scale, a sequential scan is fine.
-- Add an HNSW index later once chunk counts are large enough to warrant it.
