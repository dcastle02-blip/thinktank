-- Reconcile Sep 16 Inbound ASRS timing evidence and document TGW internal software roles.
-- Source evidence:
--   Pasted text(20260927-024211).txt
--   TGW Software Layout (002).pdf
-- Operational note: the Sep 16 timing pattern is observed. The root cause of the message delay remains unconfirmed.

begin;

insert into public.thinktank_system_registry
  (canonical_key,name,system_type,role_description,aliases,metadata,status)
values
  ('tgw-hgw','TGW HostGateway (HGW)','integration',
   'TGW host communication component. Receives incoming host messages, sends outgoing host messages, re-establishes lost host connections, and persists messages until successfully processed and sent.',
   array['HGW','HostGateway'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active'),
  ('tgw-ws','TGW Warehouse Service (WS)','automation_wcs',
   'TGW Warehouse Service layer containing workflow, storage/inventory and material-flow services used to execute warehouse logic.',
   array['WS','Warehouse Service','WS 1.9.17'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active'),
  ('tgw-bws','TGW Business Workflow Service (BWS)','automation_wcs',
   'Controls flow of work based on events such as LREP or host messages and conditions that determine the next logical path.',
   array['BWS','Business Workflow Service'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active'),
  ('tgw-sis','TGW Storage and Inventory Service (SIS)','automation_wcs',
   'Manages inventory, load carrier and location updates to the SIS database; acts as a main decision maker for outbound/storage logic and creates needed data from customer messages.',
   array['SIS','Storage and Inventory Service'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active'),
  ('tgw-mfs','TGW Material Flow Service (MFS)','automation_wcs',
   'Handles transport logic on the WS level, including when to move load carriers, transport priority, path selection and when to request additional transports.',
   array['MFS','Material Flow Service'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active'),
  ('tgw-ts','TGW Transport Service (TS)','automation_wcs',
   'Contains active transport information, determines which load carriers route to the next direct location and retains device status used in transport decisions.',
   array['TS','Transport Service','TS 3.6.11'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active'),
  ('tgw-dgw','TGW Device Gateway (DGW)','integration',
   'Communicates with the PLC by translating transportation data such as requests and load-carrier appearances into formats used by the PLC and TS.',
   array['DGW','Device Gateway'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout (002).pdf','authority','documented_system_behavior'),'active')
on conflict (canonical_key) do update set
  name=excluded.name,system_type=excluded.system_type,role_description=excluded.role_description,
  aliases=excluded.aliases,metadata=public.thinktank_system_registry.metadata || excluded.metadata,
  status=excluded.status,updated_at=now();

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'tgw-dgw-to-plc-transport-control',s.id,d.id,'TGW internal device interface',
       'Transportation data / request / load-carrier appeared events',
       'TGW transport execution requires PLC/device communication.',
       'PLC and TS exchange translated transportation/device data through DGW.',
       jsonb_build_object('system_family','TGW Commander','scope','documented architecture'),'active',
       jsonb_build_object('source','TGW Software Layout (002).pdf','authority','documented_system_behavior','exact_inbound_supply_message_path','not established by this document')
from public.thinktank_system_registry s
join public.thinktank_system_registry d on d.canonical_key='plc'
where s.canonical_key='tgw-dgw'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,source_effective_date,status)
select 'lvo-inbound-asrs-2026-09-16-late-marriagemission',n.id,'exception',
       'On 2026-09-16, iLPN 00112000057027519480 reached the RECV4 routing decision at 10:23:39 with no work type / empty WorkStack, so COFE selected Inb_NoWork / RECV_MF1. The WM MARRIAGEMISSION carrying LogicalDivert=IBASRS arrived at 10:23:55, 16 seconds later. After reinduction, COFE routed the carton to ASRS correctly.',
       jsonb_build_object('ilpn','00112000057027519480','recv4_scan','2026-09-16T10:23:39','destination_arrival','2026-09-16T10:23:55','delay_seconds',16,'pre_message_workstack','empty','pre_message_route','Inb_NoWork / RECV_MF1','message_type','MARRIAGEMISSION','logical_divert','IBASRS','reinduct_result','ASRS'),
       jsonb_build_object('facility','LVO','process','Inbound ASRS','event_date','2026-09-16'),
       'observed',1.0,'2026-09-16','active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-2026-09-16-late-marriagemission' and c.status='active');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'document','Pasted text(20260927-024211).txt',
       'RECV4 scan/route at 10:23:39 occurred with no work type; MARRIAGEMISSION destination arrived from WM at 10:23:55; reinduction later routed to ASRS.',
       jsonb_build_object('file_ref','turn76file1','line_range','251-315','evidence_class','direct_log')
from public.thinktank_process_claims c
where c.claim_key='lvo-inbound-asrs-2026-09-16-late-marriagemission' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Pasted text(20260927-024211).txt');

insert into public.thinktank_claim_systems(claim_id,system_id,relationship)
select c.id,s.id,'observed_across'
from public.thinktank_process_claims c cross join public.thinktank_system_registry s
where c.claim_key='lvo-inbound-asrs-2026-09-16-late-marriagemission' and c.status='active'
  and s.canonical_key in ('wmos','cofe')
on conflict do nothing;

insert into public.thinktank_claim_facilities(claim_id,facility_id,relationship)
select c.id,f.id,'applies_to'
from public.thinktank_process_claims c cross join public.thinktank_facilities f
where c.claim_key='lvo-inbound-asrs-2026-09-16-late-marriagemission' and c.status='active' and f.facility_key='lvo'
on conflict do nothing;

insert into public.thinktank_embedding_queue(claim_id,status,attempts,queued_at)
select c.id,'pending',0,now()
from public.thinktank_process_claims c
where c.claim_key='lvo-inbound-asrs-2026-09-16-late-marriagemission' and c.status='active' and c.embedding is null
on conflict (claim_id) do update set
  status=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.status else 'pending' end,
  queued_at=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.queued_at else now() end;

commit;
