-- Adds semantic search RPC + minimal embedding backfill tracking columns
-- Assumes pgvector extension already enabled and thinktank_document_chunks.embedding exists.

begin;

-- Tracking columns to support backfill retries / auditing
alter table public.thinktank_document_chunks
  add column if not exists embedding_attempts int not null default 0,
  add column if not exists embedded_at timestamptz;

-- Semantic match RPC
create or replace function public.match_thinktank_chunks(
  query_embedding vector(1536),
  match_count int default 12
)
returns table (
  id bigint,
  document_id uuid,
  document_name text,
  chunk_index int,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.document_id,
    c.document_name,
    c.chunk_index,
    c.content,
    (1 - (c.embedding <=> query_embedding))::float as similarity
  from public.thinktank_document_chunks c
  where c.embedding is not null
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

commit;
