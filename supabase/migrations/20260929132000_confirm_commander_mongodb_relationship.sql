-- Confirm MongoDB as the database used by TGW Commander, while preserving the remaining unknowns.
-- Operational clarification 2026-09-29.

begin;

update public.thinktank_system_registry
set role_description='MongoDB used by TGW Commander as its database. The exact collections, read/write patterns, and relationship of specific Inbound ASRS Supply messages to Mongo remain to be documented.',
    metadata=metadata || jsonb_build_object(
      'commander_database',true,
      'commander_relationship','confirmed_operational',
      'exact_supply_message_persistence_path','not yet established'
    ),
    updated_at=now()
where canonical_key='tgw-mongodb';

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select
  'tgw-commander-uses-mongodb',
  c.id,m.id,'database access','Commander data persistence/access',
  'TGW Commander uses MongoDB as its database.',
  'Commander data is persisted/read through MongoDB; exact collection/query behavior is not yet documented.',
  jsonb_build_object('system_family','TGW Commander','scope','LVO operational knowledge'),
  'active',
  jsonb_build_object('authority','confirmed_operational','exact_supply_message_path','not yet established')
from public.thinktank_system_registry c
join public.thinktank_system_registry m on m.canonical_key='tgw-mongodb'
where c.canonical_key='tgw'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'tgw-commander-uses-mongodb-database',
  n.id,'rule',
  'TGW Commander uses MongoDB as its database. This establishes the Commander-to-Mongo relationship, but does not by itself prove that every Inbound ASRS Supply message follows a Vargo -> Neuron -> Mongo -> Commander path or identify the exact collection used for stale-message cleanup.',
  jsonb_build_object('system','TGW Commander','database','MongoDB','relationship','uses as database','exact_supply_message_path_confirmed',false,'exact_cleanup_collection_confirmed',false),
  jsonb_build_object('facility','LVO','process','Inbound ASRS'),
  'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='tgw-commander-uses-mongodb-database' and c.status='active');

update public.thinktank_process_claims
set statement='For the LVO Inbound ASRS stale-message recovery process, MongoDB is confirmed as the database used by TGW Commander. However, the exact vendor/support screen or tool used to inspect and clear old error/reroute messages, the specific Mongo collection or other persistence location being cleared, and the exact cleanup procedure remain unknown and should not be inferred.',
    structured=structured || jsonb_build_object('commander_uses_mongodb',true,'mongo_relationship_confirmed',true,'exact_cleanup_collection_unknown',true),
    updated_at=now()
where claim_key='lvo-inbound-asrs-vendor-screen-observability-boundary' and status='active';

update public.thinktank_process_claims
set statement='Working operational theory: Inbound ASRS destination/Supply processing is being disrupted by stale error and reroute messages associated with carrier loads somewhere in the Neuron/TGW processing path. MongoDB is confirmed as the database used by Commander, and clearing old messages plus bouncing Neuron has been followed by restored inbound flow. What remains unproven is why the messages accumulate, the exact queue/collection in which the blocking state resides, and whether the delay is transport, persistence, or Commander-side processing/visibility.',
    structured=structured || jsonb_build_object('commander_uses_mongodb',true,'exact_blocking_collection_confirmed',false,'exact_failure_boundary_confirmed',false),
    confidence=0.94,
    updated_at=now()
where claim_key='lvo-inbound-asrs-neuron-mongo-backlog-hypothesis' and status='active';

commit;
