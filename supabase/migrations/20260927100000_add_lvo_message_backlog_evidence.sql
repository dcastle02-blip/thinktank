-- Add LVO TGW database/message-path evidence and keep Neuron/Mongo as an explicit unconfirmed hypothesis.
-- Sources: Pasted text(20260927-144608).txt and LVO_issues_on_20260910_12pm.zip.

begin;

insert into public.thinktank_system_registry
  (canonical_key,name,system_type,role_description,aliases,metadata,status)
values
  ('tgw-esb-transfer-db','TGW ESB Transfer Database','integration_middleware',
   'Persistent TGW host-message store. TGW Software Layout states that messages sent to and from the host are persisted in JSON. Email/database evidence references the ESBTRANSFER table and PENDING_CHANGES processing.',
   array['ESB Transfer Database','ESBTRANSFER'],
   jsonb_build_object('parent_system_key','tgw','source','TGW Software Layout / 2026-09-10 LVO DBA evidence','authority','system_document'),'active'),
  ('tgw-mongodb','TGW MongoDB','data_platform',
   'TGW-related MongoDB instance referenced during operational troubleshooting. Exact functional ownership and role in the Inbound ASRS Supply path are not yet established in Process Memory.',
   array['Mongo','MongoDB'],
   jsonb_build_object('parent_system_key','tgw','role_certainty','unconfirmed','source','operational troubleshooting'),'active')
on conflict (canonical_key) do update set
  name=excluded.name,system_type=excluded.system_type,role_description=excluded.role_description,
  aliases=excluded.aliases,metadata=public.thinktank_system_registry.metadata || excluded.metadata,
  status=excluded.status,updated_at=now();

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'tgw-hgw-esb-message-persistence',h.id,d.id,'database persistence',
       'Host messages / pending changes',
       'HGW processes host communication and persists messages until they are successfully processed and sent.',
       'Message state is persisted in the ESB transfer store.',
       jsonb_build_object('system_family','TGW Commander','scope','documented architecture'),'active',
       jsonb_build_object('source','TGW Software Layout (002).pdf','authority','system_document','table_observed','ESBTRANSFER')
from public.thinktank_system_registry h
join public.thinktank_system_registry d on d.canonical_key='tgw-esb-transfer-db'
where h.canonical_key='tgw-hgw'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,source_effective_date,status)
select 'lvo-tgw-2026-09-10-database-slowness',n.id,'exception',
       'During the 2026-09-10 LVO slowness window, DBA analysis reported Top SQL as the dominant AWR finding (about 65%) and temporary-tablespace I/O as another material finding (about 17%). The ESBTRANSFER host-message query was specifically called out for index/execution-plan review by TGW and Gap DBA teams.',
       jsonb_build_object('event_date','2026-09-10','awr_top_sql_weight_pct',65,'awr_temp_io_weight_pct',17,'message_store_table','ESBTRANSFER','root_cause_of_2026_09_16_incident',false),
       jsonb_build_object('facility','LVO','system_family','TGW','incident_scope','database/platform slowness'),
       'system_document',1.0,'2026-09-10','active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-tgw-2026-09-10-database-slowness' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select 'lvo-inbound-asrs-neuron-mongo-backlog-hypothesis',n.id,'exception',
       'Working operational theory: Inbound ASRS destination/Supply messages may be backing up or hanging in the Neuron/TGW message-processing path, with a potentially full or unhealthy TGW MongoDB instance considered as one possible contributor. This is not a confirmed root cause. Current evidence confirms delayed destination-message availability at COFE and separate TGW/database slowness, but does not yet prove that Neuron or MongoDB caused the delay.',
       jsonb_build_object('hypothesis','message backlog/hang in Neuron/TGW integration path','possible_contributor','TGW MongoDB full/unhealthy','root_cause_confirmed',false,'supporting_observation_1','2026-09-16 MARRIAGEMISSION arrived after RECV4 routing decision','supporting_observation_2','2026-09-10 LVO TGW database slowness and ESBTRANSFER query concerns','requires_proof',jsonb_build_array('Neuron queue/backlog evidence','MongoDB capacity/health evidence','timestamp correlation across WMOS/Vargo/MQ/Neuron/Commander')),
       jsonb_build_object('facility','LVO','process','Inbound ASRS'),
       'observed',0.75,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-neuron-mongo-backlog-hypothesis' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,source_effective_date,status)
select 'lvo-2026-09-01-plc-destination-timing-issue',n.id,'exception',
       'A separate LVO TGW issue tracked around 2026-09-01 documented an intermittent timing condition where the MFC was sending destination information but the affected PLC did not appear to receive it before the tote/carton was diverted to reject. TGW stated its system routed normally when a destination/DLST was available and rejected when no destination was available; PLC logging was being added to determine the message-delay root cause.',
       jsonb_build_object('incident_family','TGW destination timing','boundary','MFC/TGW to PLC','root_cause_confirmed',false,'diagnostic_action','capture detailed PLC transport logs'),
       jsonb_build_object('facility','LVO','incident_scope','separate historical TGW timing issue','do_not_merge_with_2026_09_16',true),
       'system_document',1.0,'2026-09-01','active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-2026-09-01-plc-destination-timing-issue' and c.status='active');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'document','Pasted text(20260927-144608).txt',
       'LVO DBA email: AWR findings identified Top SQL (~65%) and I/O/temp space (~17%); later TGW follow-up called out ESBTRANSFER query for index and execution-plan review.',
       jsonb_build_object('file_ref','turn86file0','line_ranges',jsonb_build_array('17-22','1919-1936'),'evidence_class','email_analysis')
from public.thinktank_process_claims c
where c.claim_key='lvo-tgw-2026-09-10-database-slowness' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Pasted text(20260927-144608).txt');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'document','LVO_issues_on_20260910_12pm.zip',
       'SQL Tuning Advisor report for SQL ID fmt40tdbybc1p queried ESBTRANSFER rows with PENDING_CHANGES=1 for subject PoetBidirectional. Advisor found a potentially better execution plan and recommended a SQL profile with estimated 99.99% benefit; the improved plan used IDX_ESBTRANSFER_SUBJ_PEND.',
       jsonb_build_object('archive_file','LVO_issues_on_20260910_12pm.zip','report','SQLTuningAdvisorReports/sqltune_fmt40tdbybc1p.txt','evidence_class','database_tuning_report')
from public.thinktank_process_claims c
where c.claim_key='lvo-tgw-2026-09-10-database-slowness' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='LVO_issues_on_20260910_12pm.zip');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'manual','Operational theory 2026-09-27',
       'Dylan: theory is that messages were hung up in Neuron and potentially MongoDB was full.',
       jsonb_build_object('evidence_class','operator_hypothesis','root_cause_confirmed',false)
from public.thinktank_process_claims c
where c.claim_key='lvo-inbound-asrs-neuron-mongo-backlog-hypothesis' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Operational theory 2026-09-27');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'document','Pasted text(20260927-144608).txt',
       'LVO Crane Block 1 issue: logging was being implemented for PLC transports; TGW stated routing is normal when destination/DLST is received and reject occurs when destination is unavailable; initial analysis indicated MFC may send destination before PLC receives it in time.',
       jsonb_build_object('file_ref','turn86file0','line_range','2114-2121','evidence_class','email_issue_tracker')
from public.thinktank_process_claims c
where c.claim_key='lvo-2026-09-01-plc-destination-timing-issue' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Pasted text(20260927-144608).txt');

insert into public.thinktank_claim_systems(claim_id,system_id,relationship)
select c.id,s.id,'hypothesized_failure_domain'
from public.thinktank_process_claims c cross join public.thinktank_system_registry s
where c.claim_key='lvo-inbound-asrs-neuron-mongo-backlog-hypothesis' and c.status='active'
  and s.canonical_key in ('neuron','tgw-mongodb','tgw-esb-transfer-db','tgw','cofe','wmos')
on conflict do nothing;

insert into public.thinktank_claim_systems(claim_id,system_id,relationship)
select c.id,s.id,'observed_platform'
from public.thinktank_process_claims c cross join public.thinktank_system_registry s
where c.claim_key='lvo-tgw-2026-09-10-database-slowness' and c.status='active'
  and s.canonical_key in ('tgw','tgw-esb-transfer-db','tgw-ws')
on conflict do nothing;

insert into public.thinktank_claim_systems(claim_id,system_id,relationship)
select c.id,s.id,'observed_boundary'
from public.thinktank_process_claims c cross join public.thinktank_system_registry s
where c.claim_key='lvo-2026-09-01-plc-destination-timing-issue' and c.status='active'
  and s.canonical_key in ('tgw','plc','tgw-dgw','tgw-ts')
on conflict do nothing;

insert into public.thinktank_claim_facilities(claim_id,facility_id,relationship)
select c.id,f.id,'applies_to'
from public.thinktank_process_claims c cross join public.thinktank_facilities f
where c.claim_key in ('lvo-tgw-2026-09-10-database-slowness','lvo-inbound-asrs-neuron-mongo-backlog-hypothesis','lvo-2026-09-01-plc-destination-timing-issue')
  and c.status='active' and f.facility_key='lvo'
on conflict do nothing;

insert into public.thinktank_embedding_queue(claim_id,status,attempts,queued_at)
select c.id,'pending',0,now()
from public.thinktank_process_claims c
where c.claim_key in ('lvo-tgw-2026-09-10-database-slowness','lvo-inbound-asrs-neuron-mongo-backlog-hypothesis','lvo-2026-09-01-plc-destination-timing-issue')
  and c.status='active' and c.embedding is null
on conflict (claim_id) do update set
  status=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.status else 'pending' end,
  queued_at=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.queued_at else now() end;

commit;
