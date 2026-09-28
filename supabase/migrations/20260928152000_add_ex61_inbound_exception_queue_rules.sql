-- Add two EX61-documented Inbound ASRS behaviors to Process Memory.
-- Keep designed rejection/demap behavior separate from the recent stale-message backlog incident.

begin;

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'inbound-asrs-reject-to-manual-csl-demap',
  n.id,'exception',
  'EX61 documents a designed receiving exception branch in which an iLPN allocated to Inbound ASRS but rejected is rerouted to Manual CSL. When the LPN is located to an allocatable CSL location, WMOS generates the custom iLPN Demap message so POET/COFE no longer expects the iLPN in Inbound ASRS.',
  jsonb_build_object('design_exception',true,'initial_allocation','Inbound ASRS','physical_exception_destination','Manual CSL','followup_message','iLPN Demap','purpose','remove ASRS expectation for rejected iLPN'),
  jsonb_build_object('process','Inbound ASRS','scope','EX61 documented behavior'),
  'system_document',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='inbound-asrs-reject-to-manual-csl-demap' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'inbound-asrs-inventory-sync-separate-message-queue',
  n.id,'rule',
  'EX61 states that Inbound ASRS Inventory Sync messages are processed on a separate queue from other MHE messages.',
  jsonb_build_object('message_family','Inventory Sync','queue_relationship','separate from other MHE messages'),
  jsonb_build_object('process','Inbound ASRS','scope','EX61 documented behavior'),
  'system_document',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='inbound-asrs-inventory-sync-separate-message-queue' and c.status='active');

commit;
