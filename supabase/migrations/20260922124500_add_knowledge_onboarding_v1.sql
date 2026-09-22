begin;

create table if not exists public.thinktank_onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Operational Knowledge Baseline',
  status text not null default 'setup'
    check (status in ('setup','analyzing','interview','ready','paused')),
  baseline_label text not null default 'baseline-v1',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.thinktank_onboarding_gaps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.thinktank_onboarding_sessions(id) on delete cascade,
  gap_key text not null,
  category text not null
    check (category in ('needs_sop','needs_clarification','conflict','partial','coverage')),
  title text not null,
  question text not null,
  why_it_matters text,
  scope jsonb not null default '{}'::jsonb,
  related_claim_keys text[] not null default '{}'::text[],
  priority integer not null default 50 check (priority >= 1 and priority <= 100),
  status text not null default 'open'
    check (status in ('open','answered','resolved','dismissed')),
  answer_text text,
  resolution jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id,gap_key)
);

create index if not exists thinktank_onboarding_gaps_queue_idx
  on public.thinktank_onboarding_gaps(session_id,status,priority desc,created_at);

alter table public.thinktank_onboarding_sessions enable row level security;
alter table public.thinktank_onboarding_gaps enable row level security;

revoke all on table public.thinktank_onboarding_sessions from anon, authenticated;
revoke all on table public.thinktank_onboarding_gaps from anon, authenticated;

commit;
