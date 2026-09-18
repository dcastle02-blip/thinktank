create table if not exists public.thinktank_tool_permissions (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github','supabase')),
  capability text not null check (capability in ('read','write','destructive')),
  mode text not null check (mode in ('auto','approval','disabled')),
  scope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, capability)
);

alter table public.thinktank_tool_permissions enable row level security;
revoke all on table public.thinktank_tool_permissions from anon, authenticated;

insert into public.thinktank_tool_permissions (provider, capability, mode, scope)
values
  ('github','read','auto','{"repository":"dcastle02-blip/thinktank"}'::jsonb),
  ('github','write','approval','{"repository":"dcastle02-blip/thinktank"}'::jsonb),
  ('github','destructive','approval','{"repository":"dcastle02-blip/thinktank"}'::jsonb),
  ('supabase','read','auto','{"project_ref":"ddxhpsgwxqoejghmsatg"}'::jsonb),
  ('supabase','write','approval','{"project_ref":"ddxhpsgwxqoejghmsatg"}'::jsonb),
  ('supabase','destructive','approval','{"project_ref":"ddxhpsgwxqoejghmsatg"}'::jsonb)
on conflict (provider, capability) do nothing;

create table if not exists public.thinktank_tool_activity (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github','supabase')),
  tool_name text not null,
  capability text not null check (capability in ('read','write','destructive')),
  requested_by text not null check (requested_by in ('Dylan','GPT','Claude','System')),
  arguments jsonb not null default '{}'::jsonb,
  status text not null check (status in ('requested','awaiting_approval','approved','running','succeeded','failed','denied')),
  result_summary text,
  error_text text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  completed_at timestamptz
);

create index if not exists thinktank_tool_activity_created_at_idx
  on public.thinktank_tool_activity (created_at desc);

alter table public.thinktank_tool_activity enable row level security;
revoke all on table public.thinktank_tool_activity from anon, authenticated;
