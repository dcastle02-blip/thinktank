-- Capture stale error/reroute message backlog behavior for LVO Inbound ASRS.
-- Operational clarification: old messages were error messages and reroute messages from carrier loads;
-- clearing them restored the ability for cartons to inbound.
-- Preserve backlog cleanup as an observed recovery pattern while leaving the underlying accumulation cause unresolved.

begin;

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'lvo-inbound-asrs-stale-error-reroute-message-backlog',
  n.id,'exception',
  'During the LVO Inbound ASRS message-delay/reject issue, the "old messages" being cleared included error messages and reroute messages associated with carrier loads. Clearing those messages restored the ability for cartons to inbound. The underlying reason those messages accumulated remains unresolved.',
  jsonb_build_object('backlog_contents',jsonb_build_array('error messages','reroute messages'),'associated_object_term','carrier loads','recovery_action','clear old/backlogged messages','observed_result','cartons able to inbound','underlying_accumulation_cause_confirmed',false),
  jsonb_build_object('facility','LVO','process','Inbound ASRS','incident_family','message delay / reject'),
  'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-stale-error-reroute-message-backlog' and c.status='active');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'manual','Operational clarification 2026-09-27',
       'Dylan: old messages were error messages and reroute messages from carrier loads; they clear those and then the cartons are able to inbound.',
       jsonb_build_object('evidence_class','operator-confirmed troubleshooting behavior','root_cause_confirmed',false,'recovery_pattern_confirmed',true)
from public.thinktank_process_claims c
where c.claim_key='lvo-inbound-asrs-stale-error-reroute-message-backlog' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Operational clarification 2026-09-27');

insert into public.thinktank_claim_systems(claim_id,system_id,relationship)
select c.id,s.id,
       case when s.canonical_key='neuron' then 'suspected_message_backlog_location'
            when s.canonical_key='tgw-mongodb' then 'possible_persistence_component'
            else 'incident_system' end
from public.thinktank_process_claims c
cross join public.thinktank_system_registry s
where c.claim_key='lvo-inbound-asrs-stale-error-reroute-message-backlog' and c.status='active'
  and s.canonical_key in ('neuron','tgw-mongodb','tgw')
on conflict do nothing;

insert into public.thinktank_claim_facilities(claim_id,facility_id,relationship)
select c.id,f.id,'applies_to'
from public.thinktank_process_claims c
cross join public.thinktank_facilities f
where c.claim_key='lvo-inbound-asrs-stale-error-reroute-message-backlog'
  and c.status='active' and f.facility_key='lvo'
on conflict do nothing;

update public.thinktank_process_claims
set statement='Working operational theory: Inbound ASRS destination/Supply processing was being disrupted by a backlog of stale error and reroute messages associated with carrier loads in the Neuron/TGW message-processing path. Clearing the old messages and bouncing Neuron was followed by restored inbound flow. MongoDB capacity/health remains a possible contributor, but the exact storage location of the backlog, why it accumulated, and whether MongoDB was actually full are not yet proven.',
    structured=structured || jsonb_build_object('backlog_contents',jsonb_build_array('error messages','reroute messages'),'associated_object_term','carrier loads','clearing_backlog_restored_inbound',true,'mongo_full_confirmed',false,'root_cause_confirmed',false),
    confidence=0.92,
    updated_at=now()
where claim_key='lvo-inbound-asrs-neuron-mongo-backlog-hypothesis' and status='active';

insert into public.thinktank_diagnostic_checks
  (diagnostic_key,symptom,check_order,process_node_id,entity_id,check_instruction,evidence_to_observe,if_pass,if_fail,scope,authority,confidence,status)
select
  'lvo-inbound-asrs-entry-reject-045-check-stale-error-reroute-backlog',
  'Carton rejects or routes to no-work because expected inbound destination/work is not available in time.',
  45,n.id,e.id,
  'Before clearing or restarting anything, inspect the Neuron/TGW message-processing path for accumulated old error messages and reroute messages associated with carrier loads. Capture message counts, timestamps, affected identifiers and queue/store location if visible.',
  'Presence or absence of stale/backlogged error and reroute messages, message age, affected carrier-load identifiers, and where the backlog is physically/logically stored.',
  'Preserve evidence, then follow the established recovery procedure to clear the stale messages and verify whether inbound flow resumes.',
  'Continue tracing message timing through Neuron, Commander and downstream control boundaries; do not assume backlog is the cause.',
  jsonb_build_object('facility','LVO','process','Inbound ASRS','evidence_preservation_required',true),
  'confirmed_operational',0.95,'active'
from public.thinktank_process_nodes n
cross join public.thinktank_entity_registry e
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff' and e.canonical_key='ilpn'
on conflict (diagnostic_key) do update set
  symptom=excluded.symptom,check_order=excluded.check_order,process_node_id=excluded.process_node_id,
  entity_id=excluded.entity_id,check_instruction=excluded.check_instruction,evidence_to_observe=excluded.evidence_to_observe,
  if_pass=excluded.if_pass,if_fail=excluded.if_fail,scope=excluded.scope,authority=excluded.authority,
  confidence=excluded.confidence,status=excluded.status,updated_at=now();

insert into public.thinktank_embedding_queue(claim_id,status,attempts,queued_at)
select c.id,'pending',0,now()
from public.thinktank_process_claims c
where c.claim_key in ('lvo-inbound-asrs-stale-error-reroute-message-backlog','lvo-inbound-asrs-neuron-mongo-backlog-hypothesis')
  and c.status='active' and c.embedding is null
on conflict (claim_id) do update set
  status=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.status else 'pending' end,
  queued_at=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.queued_at else now() end;

commit;
