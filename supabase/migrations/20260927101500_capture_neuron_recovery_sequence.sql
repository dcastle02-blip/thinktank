-- Capture confirmed recovery sequence for the LVO Inbound ASRS message-delay incident.
-- Operational clarification 2026-09-27:
-- reset + clear old messages + Neuron bounce -> flow began working.
-- Preserve as a recovery sequence, not as a proven isolated root cause.

begin;

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'lvo-inbound-asrs-neuron-reset-clear-bounce-action',
  n.id,'exception',
  'During troubleshooting of the LVO Inbound ASRS message-delay/reject issue, the response team performed a reset, cleared old messages, and performed a "bounce" of Neuron.',
  jsonb_build_object('actions',jsonb_build_array('reset','clear old messages','bounce Neuron'),'neuron_bounce_meaning','operator terminology preserved; exact technical restart procedure not yet documented'),
  jsonb_build_object('facility','LVO','process','Inbound ASRS','incident_family','message delay / reject'),
  'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-neuron-reset-clear-bounce-action' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'lvo-inbound-asrs-recovery-after-neuron-maintenance',
  n.id,'exception',
  'After the troubleshooting team reset the affected services, cleared old messages, and bounced Neuron, the Inbound ASRS flow began working again. This establishes a recovery sequence and temporal association, but does not yet isolate which action or component caused the recovery.',
  jsonb_build_object('recovery_observed',true,'preceding_actions',jsonb_build_array('reset','clear old messages','bounce Neuron'),'causal_action_isolated',false,'root_cause_confirmed',false),
  jsonb_build_object('facility','LVO','process','Inbound ASRS','incident_family','message delay / reject'),
  'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-recovery-after-neuron-maintenance' and c.status='active');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'manual','Operational clarification 2026-09-27',
       case c.claim_key
         when 'lvo-inbound-asrs-neuron-reset-clear-bounce-action'
           then 'Dylan: They did a reset, cleared old messages, and did a "bounce" for Neuron.'
         else 'Dylan: then it began working.'
       end,
       jsonb_build_object('evidence_class','operator-confirmed troubleshooting sequence','causal_attribution',case when c.claim_key='lvo-inbound-asrs-recovery-after-neuron-maintenance' then 'not isolated' else 'not applicable' end)
from public.thinktank_process_claims c
where c.claim_key in ('lvo-inbound-asrs-neuron-reset-clear-bounce-action','lvo-inbound-asrs-recovery-after-neuron-maintenance')
  and c.status='active'
  and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Operational clarification 2026-09-27');

insert into public.thinktank_claim_systems(claim_id,system_id,relationship)
select c.id,s.id,
       case when s.canonical_key='neuron' then 'recovery_action_target'
            when s.canonical_key='tgw-mongodb' then 'possible_message_store_involved'
            else 'incident_system' end
from public.thinktank_process_claims c
cross join public.thinktank_system_registry s
where c.claim_key in ('lvo-inbound-asrs-neuron-reset-clear-bounce-action','lvo-inbound-asrs-recovery-after-neuron-maintenance')
  and c.status='active'
  and s.canonical_key in ('neuron','tgw-mongodb','tgw')
on conflict do nothing;

insert into public.thinktank_claim_facilities(claim_id,facility_id,relationship)
select c.id,f.id,'applies_to'
from public.thinktank_process_claims c
cross join public.thinktank_facilities f
where c.claim_key in ('lvo-inbound-asrs-neuron-reset-clear-bounce-action','lvo-inbound-asrs-recovery-after-neuron-maintenance')
  and c.status='active' and f.facility_key='lvo'
on conflict do nothing;

update public.thinktank_process_claims
set statement='Working operational theory: Inbound ASRS destination/Supply messages were backing up or hanging in the Neuron/TGW message-processing path, with a potentially full or unhealthy TGW MongoDB instance considered as one possible contributor. Supporting evidence now includes delayed MARRIAGEMISSION availability at COFE and restoration of flow after a reset, clearing old messages, and bouncing Neuron. The precise failed component and which recovery action was decisive are still not proven.',
    structured=structured || jsonb_build_object('recovery_after_reset_clear_neuron_bounce',true,'causal_action_isolated',false,'root_cause_confirmed',false),
    confidence=0.85,
    updated_at=now()
where claim_key='lvo-inbound-asrs-neuron-mongo-backlog-hypothesis' and status='active';

insert into public.thinktank_embedding_queue(claim_id,status,attempts,queued_at)
select c.id,'pending',0,now()
from public.thinktank_process_claims c
where c.claim_key in ('lvo-inbound-asrs-neuron-reset-clear-bounce-action','lvo-inbound-asrs-recovery-after-neuron-maintenance','lvo-inbound-asrs-neuron-mongo-backlog-hypothesis')
  and c.status='active' and c.embedding is null
on conflict (claim_id) do update set
  status=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.status else 'pending' end,
  queued_at=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.queued_at else now() end;

commit;
