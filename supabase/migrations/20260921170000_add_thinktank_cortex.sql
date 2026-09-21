begin;

create table if not exists public.thinktank_cortex_experiences (
  id uuid primary key default gen_random_uuid(),
  source_task_id uuid references public.thinktank_agent_tasks(id) on delete set null,
  goal text not null,
  outcome text not null check (outcome in ('success','partial','failure','cancelled')),
  summary text not null,
  lesson text not null,
  evidence jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}'::text[],
  embedding vector(1536),
  created_at timestamptz not null default now(),
  unique (source_task_id)
);

create table if not exists public.thinktank_cortex_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null unique,
  title text not null,
  instruction text not null,
  rationale text,
  status text not null default 'proposed'
    check (status in ('proposed','approved','rejected','retired')),
  source_task_id uuid references public.thinktank_agent_tasks(id) on delete set null,
  confidence real not null default 0.5 check (confidence >= 0 and confidence <= 1),
  times_used integer not null default 0 check (times_used >= 0),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists thinktank_cortex_experiences_created_idx
  on public.thinktank_cortex_experiences(created_at desc);

create index if not exists thinktank_cortex_rules_status_idx
  on public.thinktank_cortex_rules(status, updated_at desc);

alter table public.thinktank_cortex_experiences enable row level security;
alter table public.thinktank_cortex_rules enable row level security;

revoke all on table public.thinktank_cortex_experiences from anon, authenticated;
revoke all on table public.thinktank_cortex_rules from anon, authenticated;

create or replace function public.match_thinktank_cortex_experiences(
  query_embedding vector(1536),
  match_count integer default 6
)
returns table (
  id uuid,
  source_task_id uuid,
  goal text,
  outcome text,
  summary text,
  lesson text,
  evidence jsonb,
  tags text[],
  similarity float
)
language sql
stable
set search_path = public
as $fn$
  select
    e.id,
    e.source_task_id,
    e.goal,
    e.outcome,
    e.summary,
    e.lesson,
    e.evidence,
    e.tags,
    (1 - (e.embedding <=> query_embedding))::float as similarity
  from public.thinktank_cortex_experiences e
  where e.embedding is not null
  order by e.embedding <=> query_embedding
  limit greatest(1, least(coalesce(match_count, 6), 10));
$fn$;

revoke all on function public.match_thinktank_cortex_experiences(vector, integer) from public, anon, authenticated;

commit;
