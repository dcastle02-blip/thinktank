begin;

create table if not exists public.thinktank_entity_registry (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  name text not null,
  entity_type text not null check (entity_type in ('inventory_object','order','container','task','document','location','equipment','data_asset','other')),
  description text,
  aliases text[] not null default '{}'::text[],
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','historical','planned','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thinktank_claim_entities (
  claim_id uuid not null references public.thinktank_process_claims(id) on delete cascade,
  entity_id uuid not null references public.thinktank_entity_registry(id) on delete cascade,
  relationship text not null default 'applies_to',
  primary key (claim_id, entity_id, relationship)
);

create table if not exists public.thinktank_system_integrations (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null unique,
  source_system_id uuid references public.thinktank_system_registry(id) on delete set null,
  destination_system_id uuid references public.thinktank_system_registry(id) on delete set null,
  interface_type text,
  message_or_event text,
  trigger_description text,
  acknowledgement_or_state_change text,
  scope jsonb not null default '{}'::jsonb,
  effective_from date,
  effective_to date,
  status text not null default 'active' check (status in ('active','historical','planned','retired','unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thinktank_claim_integrations (
  claim_id uuid not null references public.thinktank_process_claims(id) on delete cascade,
  integration_id uuid not null references public.thinktank_system_integrations(id) on delete cascade,
  relationship text not null default 'describes',
  primary key (claim_id, integration_id, relationship)
);

create table if not exists public.thinktank_state_definitions (
  id uuid primary key default gen_random_uuid(),
  state_key text not null unique,
  entity_id uuid references public.thinktank_entity_registry(id) on delete set null,
  name text not null,
  description text,
  owner_system_id uuid references public.thinktank_system_registry(id) on delete set null,
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','historical','planned','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thinktank_state_transitions (
  id uuid primary key default gen_random_uuid(),
  transition_key text not null unique,
  entity_id uuid references public.thinktank_entity_registry(id) on delete set null,
  from_state_id uuid references public.thinktank_state_definitions(id) on delete set null,
  to_state_id uuid references public.thinktank_state_definitions(id) on delete set null,
  trigger_event_id uuid references public.thinktank_event_definitions(id) on delete set null,
  integration_id uuid references public.thinktank_system_integrations(id) on delete set null,
  prerequisite jsonb not null default '{}'::jsonb,
  scope jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','historical','planned','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.thinktank_diagnostic_checks (
  id uuid primary key default gen_random_uuid(),
  diagnostic_key text not null unique,
  symptom text not null,
  check_order integer not null default 100,
  prerequisite_claim_id uuid references public.thinktank_process_claims(id) on delete set null,
  process_node_id uuid references public.thinktank_process_nodes(id) on delete set null,
  entity_id uuid references public.thinktank_entity_registry(id) on delete set null,
  expected_state_id uuid references public.thinktank_state_definitions(id) on delete set null,
  check_instruction text not null,
  evidence_to_observe text,
  if_pass text,
  if_fail text,
  scope jsonb not null default '{}'::jsonb,
  authority text not null default 'confirmed_operational',
  confidence real not null default 1.0 check (confidence >= 0 and confidence <= 1),
  status text not null default 'active' check (status in ('active','draft','historical','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.thinktank_entity_registry enable row level security;
alter table public.thinktank_claim_entities enable row level security;
alter table public.thinktank_system_integrations enable row level security;
alter table public.thinktank_claim_integrations enable row level security;
alter table public.thinktank_state_definitions enable row level security;
alter table public.thinktank_state_transitions enable row level security;
alter table public.thinktank_diagnostic_checks enable row level security;

revoke all on table public.thinktank_entity_registry from anon, authenticated;
revoke all on table public.thinktank_claim_entities from anon, authenticated;
revoke all on table public.thinktank_system_integrations from anon, authenticated;
revoke all on table public.thinktank_claim_integrations from anon, authenticated;
revoke all on table public.thinktank_state_definitions from anon, authenticated;
revoke all on table public.thinktank_state_transitions from anon, authenticated;
revoke all on table public.thinktank_diagnostic_checks from anon, authenticated;

create index if not exists thinktank_claim_entities_entity_idx on public.thinktank_claim_entities(entity_id);
create index if not exists thinktank_integrations_source_idx on public.thinktank_system_integrations(source_system_id);
create index if not exists thinktank_integrations_destination_idx on public.thinktank_system_integrations(destination_system_id);
create index if not exists thinktank_state_definitions_entity_idx on public.thinktank_state_definitions(entity_id);
create index if not exists thinktank_state_transitions_entity_idx on public.thinktank_state_transitions(entity_id);
create index if not exists thinktank_diagnostic_checks_symptom_idx on public.thinktank_diagnostic_checks using gin(to_tsvector('simple', symptom));

commit;
