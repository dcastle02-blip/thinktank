-- Capture Inbound ASRS Supply path, TGW entry boundary, and current LVO reject diagnostic scaffold.
-- Operational source: Dylan knowledge capture 2026-09-26.
-- Important: the reject symptom is confirmed; the exact failed hop remains a hypothesis until troubleshooting evidence proves it.

begin;

insert into public.thinktank_system_registry
  (canonical_key,name,system_type,role_description,aliases,metadata,status)
values
  ('ibm-mq','IBM MQ','integration_middleware',
   'Message-queue transport used in the Inbound ASRS Supply path between Vargo/COFE and Neuron.',
   array['MQ','IBM Message Queue'],
   jsonb_build_object('process','Inbound ASRS','message_role','Supply transport'),
   'active'),
  ('neuron','Neuron','integration_middleware',
   'Integration layer in the Inbound ASRS Supply path between IBM MQ and TGW Commander.',
   array['Neuron integration'],
   jsonb_build_object('process','Inbound ASRS','message_role','Supply relay'),
   'active'),
  ('plc','TGW PLC','machine_control',
   'Machine-control layer for TGW-owned inbound ASRS conveyance and routing.',
   array['PLC','TGW machine control'],
   jsonb_build_object('process','Inbound ASRS'),
   'active')
on conflict (canonical_key) do update set
  name=excluded.name,
  system_type=excluded.system_type,
  role_description=excluded.role_description,
  aliases=excluded.aliases,
  metadata=public.thinktank_system_registry.metadata || excluded.metadata,
  status=excluded.status,
  updated_at=now();

update public.thinktank_system_registry
set aliases=(select array(select distinct x from unnest(coalesce(aliases,'{}'::text[]) || array['Vargo','WES']) x)),
    role_description='Vargo COFE warehouse execution layer; receives WMOS directives and participates in Inbound ASRS Supply messaging.',
    metadata=metadata || jsonb_build_object('inbound_asrs_supply_role','upstream WES/orchestration'),
    updated_at=now()
where canonical_key='cofe';

update public.thinktank_system_registry
set aliases=(select array(select distinct x from unnest(coalesce(aliases,'{}'::text[]) || array['TGW Commander','Commander WS','ASRS']) x)),
    role_description='TGW Commander / ASRS execution layer for storage, extraction, transport and handoff to TGW machine controls.',
    metadata=metadata || jsonb_build_object('commander',true,'inbound_asrs_supply_role','Supply consumer / automation execution'),
    updated_at=now()
where canonical_key='tgw';

insert into public.thinktank_entity_registry
  (canonical_key,name,entity_type,description,aliases,metadata,status)
values
  ('ilpn','Inbound iLPN / Carton','inventory_object',
   'Physical inbound carton/case identified by an iLPN as it moves through receiving and Inbound ASRS.',
   array['iLPN','carton','case','A Label'],
   jsonb_build_object('primary_identifier','iLPN'),
   'active')
on conflict (canonical_key) do update set
  name=excluded.name,
  description=excluded.description,
  aliases=excluded.aliases,
  metadata=public.thinktank_entity_registry.metadata || excluded.metadata,
  status=excluded.status,
  updated_at=now();

insert into public.thinktank_process_nodes
  (canonical_key,node_type,name,description,scope,aliases,status)
values
  ('node:inbound-asrs-tgw-entry-handoff','process','Inbound ASRS TGW Entry Handoff',
   'Handoff after the inbound scanner and before the loop sorter scanner where the carton enters the TGW-owned automation domain.',
   jsonb_build_object('process','Inbound ASRS','physical_boundary','post-inbound-scanner/pre-loop-sorter'),
   array['TGW entry point','Inbound ASRS entry handoff'],
   'active')
on conflict (canonical_key) do update set
  node_type=excluded.node_type,
  name=excluded.name,
  description=excluded.description,
  scope=excluded.scope,
  aliases=excluded.aliases,
  status=excluded.status,
  updated_at=now();

-- Integration chain
insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'inbound-asrs-wmos-to-cofe',s.id,d.id,'MHE integration',
       'Inbound ASRS routing/allocation data used by Vargo/COFE to support Supply messaging',
       'WMOS directs inbound processing for an iLPN intended for Inbound ASRS.',
       'Vargo/COFE has the upstream data needed to continue the Inbound ASRS handoff.',
       jsonb_build_object('process','Inbound ASRS','scope','TGW/COFE path'),'active',
       jsonb_build_object('certainty','confirmed_operational','exact_message_name','TBD')
from public.thinktank_system_registry s
join public.thinktank_system_registry d on d.canonical_key='cofe'
where s.canonical_key='wmos'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'inbound-asrs-cofe-to-ibm-mq-supply',s.id,d.id,'IBM MQ','Supply',
       'Vargo/COFE sends the Inbound ASRS Supply message toward TGW.',
       'Supply is present in the IBM MQ transport path.',
       jsonb_build_object('process','Inbound ASRS','scope','TGW/COFE path'),'active',
       jsonb_build_object('certainty','confirmed_operational')
from public.thinktank_system_registry s
join public.thinktank_system_registry d on d.canonical_key='ibm-mq'
where s.canonical_key='cofe'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'inbound-asrs-ibm-mq-to-neuron-supply',s.id,d.id,'message relay','Supply',
       'IBM MQ transports the Inbound ASRS Supply message to Neuron.',
       'Neuron receives the Supply message for forwarding toward TGW Commander.',
       jsonb_build_object('process','Inbound ASRS','scope','TGW/COFE path'),'active',
       jsonb_build_object('certainty','confirmed_operational')
from public.thinktank_system_registry s
join public.thinktank_system_registry d on d.canonical_key='neuron'
where s.canonical_key='ibm-mq'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'inbound-asrs-neuron-to-commander-supply',s.id,d.id,'integration relay','Supply',
       'Neuron forwards the Inbound ASRS Supply message to TGW Commander.',
       'TGW Commander has the Supply information for the inbound carton.',
       jsonb_build_object('process','Inbound ASRS','scope','TGW/COFE path'),'active',
       jsonb_build_object('certainty','confirmed_operational')
from public.thinktank_system_registry s
join public.thinktank_system_registry d on d.canonical_key='tgw'
where s.canonical_key='neuron'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

insert into public.thinktank_system_integrations
  (integration_key,source_system_id,destination_system_id,interface_type,message_or_event,trigger_description,acknowledgement_or_state_change,scope,status,metadata)
select 'inbound-asrs-commander-to-plc-entry-routing',s.id,d.id,'TGW internal control interface',
       'Inbound carton acceptance/routing control derived from Supply; exact TGW message name TBD',
       'TGW Commander has accepted the inbound Supply information.',
       'PLC has the information required to accept and route the carton at the TGW entry boundary.',
       jsonb_build_object('process','Inbound ASRS','physical_boundary','post-inbound-scanner/pre-loop-sorter'),'active',
       jsonb_build_object('certainty','partially_confirmed_operational','exact_message_name','TBD')
from public.thinktank_system_registry s
join public.thinktank_system_registry d on d.canonical_key='plc'
where s.canonical_key='tgw'
on conflict (integration_key) do update set
  source_system_id=excluded.source_system_id,destination_system_id=excluded.destination_system_id,
  interface_type=excluded.interface_type,message_or_event=excluded.message_or_event,
  trigger_description=excluded.trigger_description,acknowledgement_or_state_change=excluded.acknowledgement_or_state_change,
  scope=excluded.scope,status=excluded.status,metadata=excluded.metadata,updated_at=now();

-- State model
insert into public.thinktank_state_definitions
  (state_key,entity_id,name,description,owner_system_id,scope,status)
select 'ilpn:post-inbound-scan',e.id,'Post-inbound scan',
       'Inbound carton has passed the inbound scanner and is physically approaching the TGW-owned entry point.',
       null,jsonb_build_object('process','Inbound ASRS'),'active'
from public.thinktank_entity_registry e where e.canonical_key='ilpn'
on conflict (state_key) do update set
  entity_id=excluded.entity_id,name=excluded.name,description=excluded.description,
  owner_system_id=excluded.owner_system_id,scope=excluded.scope,status=excluded.status,updated_at=now();

insert into public.thinktank_state_definitions
  (state_key,entity_id,name,description,owner_system_id,scope,status)
select 'ilpn:tgw-entry-accepted',e.id,'Accepted into TGW entry',
       'TGW/PLC has the information required to accept the carton into the TGW-owned automation path before the loop sorter scanner.',
       s.id,jsonb_build_object('process','Inbound ASRS','physical_boundary','pre-loop-sorter'),'active'
from public.thinktank_entity_registry e
join public.thinktank_system_registry s on s.canonical_key='tgw'
where e.canonical_key='ilpn'
on conflict (state_key) do update set
  entity_id=excluded.entity_id,name=excluded.name,description=excluded.description,
  owner_system_id=excluded.owner_system_id,scope=excluded.scope,status=excluded.status,updated_at=now();

insert into public.thinktank_state_definitions
  (state_key,entity_id,name,description,owner_system_id,scope,status)
select 'ilpn:tgw-entry-reject',e.id,'Rejected at TGW entry',
       'Carton is diverted to the reject line at the TGW entry point after the inbound scanner and before the loop sorter scanner.',
       s.id,jsonb_build_object('process','Inbound ASRS','physical_boundary','post-inbound-scanner/pre-loop-sorter'),'active'
from public.thinktank_entity_registry e
join public.thinktank_system_registry s on s.canonical_key='tgw'
where e.canonical_key='ilpn'
on conflict (state_key) do update set
  entity_id=excluded.entity_id,name=excluded.name,description=excluded.description,
  owner_system_id=excluded.owner_system_id,scope=excluded.scope,status=excluded.status,updated_at=now();

insert into public.thinktank_state_transitions
  (transition_key,entity_id,from_state_id,to_state_id,integration_id,prerequisite,scope,status)
select 'ilpn-post-scan-to-tgw-entry-accepted',e.id,fs.id,ts.id,i.id,
       jsonb_build_object('requires','Supply reaches TGW Commander and TGW control information is available to PLC before carton reaches entry point'),
       jsonb_build_object('process','Inbound ASRS'),'active'
from public.thinktank_entity_registry e
join public.thinktank_state_definitions fs on fs.state_key='ilpn:post-inbound-scan'
join public.thinktank_state_definitions ts on ts.state_key='ilpn:tgw-entry-accepted'
join public.thinktank_system_integrations i on i.integration_key='inbound-asrs-neuron-to-commander-supply'
where e.canonical_key='ilpn'
on conflict (transition_key) do update set
  entity_id=excluded.entity_id,from_state_id=excluded.from_state_id,to_state_id=excluded.to_state_id,
  integration_id=excluded.integration_id,prerequisite=excluded.prerequisite,scope=excluded.scope,status=excluded.status,updated_at=now();

insert into public.thinktank_state_transitions
  (transition_key,entity_id,from_state_id,to_state_id,integration_id,prerequisite,scope,status)
select 'ilpn-post-scan-to-tgw-entry-reject',e.id,fs.id,ts.id,i.id,
       jsonb_build_object(
         'observed_association','Expected Supply/control information appears unavailable at TGW/PLC entry handoff',
         'root_cause_confirmed',false),
       jsonb_build_object('process','Inbound ASRS','physical_boundary','post-inbound-scanner/pre-loop-sorter'),'active'
from public.thinktank_entity_registry e
join public.thinktank_state_definitions fs on fs.state_key='ilpn:post-inbound-scan'
join public.thinktank_state_definitions ts on ts.state_key='ilpn:tgw-entry-reject'
join public.thinktank_system_integrations i on i.integration_key='inbound-asrs-commander-to-plc-entry-routing'
where e.canonical_key='ilpn'
on conflict (transition_key) do update set
  entity_id=excluded.entity_id,from_state_id=excluded.from_state_id,to_state_id=excluded.to_state_id,
  integration_id=excluded.integration_id,prerequisite=excluded.prerequisite,scope=excluded.scope,status=excluded.status,updated_at=now();

-- Claims
insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select 'inbound-asrs-supply-message-chain',n.id,'sequence',
       'For the Inbound ASRS Supply path, the operationally confirmed integration chain is WMOS -> Vargo/COFE -> IBM MQ -> Neuron -> TGW Commander -> TGW PLC.',
       jsonb_build_object('chain',jsonb_build_array('WMOS','Vargo/COFE','IBM MQ','Neuron','TGW Commander','TGW PLC')),
       jsonb_build_object('process','Inbound ASRS','scope','TGW/COFE path'),
       'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='inbound-asrs-supply-message-chain' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select 'inbound-asrs-tgw-entry-boundary',n.id,'sequence',
       'The TGW entry point for this Inbound ASRS flow is after the inbound scanner and before the loop sorter scanner; this is the point where the carton enters the TGW-owned automation domain.',
       jsonb_build_object('after','inbound scanner','before','loop sorter scanner','ownership_change','TGW'),
       jsonb_build_object('process','Inbound ASRS'),'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='inbound-asrs-tgw-entry-boundary' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select 'lvo-inbound-asrs-entry-reject-symptom',n.id,'exception',
       'A recent Inbound ASRS exception is cartons diverting to the reject line at the TGW entry point after the inbound scanner and before the loop sorter scanner.',
       jsonb_build_object('symptom','TGW entry reject','location','post-inbound-scanner/pre-loop-sorter'),
       jsonb_build_object('facility','LVO','process','Inbound ASRS'),'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-entry-reject-symptom' and c.status='active');

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select 'lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis',n.id,'exception',
       'For the recent TGW-entry rejects, the expected Supply message appears not to be reaching TGW Commander and/or the corresponding control information is not reaching the PLC before the carton arrives; the exact failing hop is not yet confirmed.',
       jsonb_build_object('hypothesis','Supply/control handoff failure','root_cause_confirmed',false,'trace_required',true),
       jsonb_build_object('facility','LVO','process','Inbound ASRS'),'observed',0.8,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis' and c.status='active');

insert into public.thinktank_process_evidence (claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'conversation','Inbound ASRS knowledge capture 2026-09-26',
       case c.claim_key
         when 'inbound-asrs-supply-message-chain' then 'Operationally confirmed path: WMOS -> Vargo -> IBM MQ -> Neuron -> Commander -> PLC.'
         when 'inbound-asrs-tgw-entry-boundary' then 'TGW entry point is after the inbound scanner and before the loop sorter scanner.'
         when 'lvo-inbound-asrs-entry-reject-symptom' then 'Recent cartons have been hitting the reject line at the TGW entry point.'
         else 'Observed troubleshooting hypothesis: Supply may not be reaching TGW Commander and back to the PLC before carton arrival; exact failing hop remains to be proven.'
       end,
       jsonb_build_object('captured_by','GPT','source_author','Dylan')
from public.thinktank_process_claims c
where c.status='active'
  and c.claim_key in ('inbound-asrs-supply-message-chain','inbound-asrs-tgw-entry-boundary','lvo-inbound-asrs-entry-reject-symptom','lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis')
  and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Inbound ASRS knowledge capture 2026-09-26');

insert into public.thinktank_claim_systems (claim_id,system_id,relationship)
select c.id,s.id,'applies_to'
from public.thinktank_process_claims c
cross join public.thinktank_system_registry s
where c.status='active'
  and c.claim_key in ('inbound-asrs-supply-message-chain','lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis')
  and s.canonical_key in ('wmos','cofe','ibm-mq','neuron','tgw','plc')
on conflict do nothing;

insert into public.thinktank_claim_entities (claim_id,entity_id,relationship)
select c.id,e.id,'applies_to'
from public.thinktank_process_claims c
cross join public.thinktank_entity_registry e
where c.status='active'
  and c.claim_key in ('inbound-asrs-supply-message-chain','inbound-asrs-tgw-entry-boundary','lvo-inbound-asrs-entry-reject-symptom','lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis')
  and e.canonical_key='ilpn'
on conflict do nothing;

insert into public.thinktank_claim_integrations (claim_id,integration_id,relationship)
select c.id,i.id,'describes'
from public.thinktank_process_claims c
cross join public.thinktank_system_integrations i
where c.status='active'
  and c.claim_key='inbound-asrs-supply-message-chain'
  and i.integration_key in ('inbound-asrs-wmos-to-cofe','inbound-asrs-cofe-to-ibm-mq-supply','inbound-asrs-ibm-mq-to-neuron-supply','inbound-asrs-neuron-to-commander-supply','inbound-asrs-commander-to-plc-entry-routing')
on conflict do nothing;

insert into public.thinktank_claim_integrations (claim_id,integration_id,relationship)
select c.id,i.id,'diagnostic_boundary'
from public.thinktank_process_claims c
cross join public.thinktank_system_integrations i
where c.status='active'
  and c.claim_key='lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis'
  and i.integration_key in ('inbound-asrs-cofe-to-ibm-mq-supply','inbound-asrs-ibm-mq-to-neuron-supply','inbound-asrs-neuron-to-commander-supply','inbound-asrs-commander-to-plc-entry-routing')
on conflict do nothing;

insert into public.thinktank_claim_facilities (claim_id,facility_id,relationship)
select c.id,f.id,'applies_to'
from public.thinktank_process_claims c
cross join public.thinktank_facilities f
where c.status='active'
  and c.claim_key in ('lvo-inbound-asrs-entry-reject-symptom','lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis')
  and f.facility_key='lvo'
on conflict do nothing;

insert into public.thinktank_facility_systems (facility_id,system_id,configuration,status)
select f.id,s.id,jsonb_build_object('process','Inbound ASRS','role','Supply path / TGW entry handoff'),'active'
from public.thinktank_facilities f
cross join public.thinktank_system_registry s
where f.facility_key='lvo'
  and s.canonical_key in ('wmos','cofe','ibm-mq','neuron','tgw','plc')
on conflict (facility_id,system_id) do update set
  configuration=public.thinktank_facility_systems.configuration || excluded.configuration,
  status='active';

-- Diagnostic scaffold. Steps 2-6 are intentionally marked inferred until the troubleshooting chat confirms exact tools/log evidence.
insert into public.thinktank_diagnostic_checks
  (diagnostic_key,symptom,check_order,process_node_id,entity_id,expected_state_id,check_instruction,evidence_to_observe,if_pass,if_fail,scope,authority,confidence,status)
select 'lvo-inbound-asrs-entry-reject-01-confirm-boundary',
       'Carton diverts to reject during Inbound ASRS induction.',10,n.id,e.id,st.id,
       'Confirm the reject occurs after the inbound scanner and before the loop sorter scanner at the TGW-owned entry point.',
       'iLPN/carton identity, reject location and event timing identify this specific entry reject rather than a later loop-sorter/recirculation reject.',
       'Continue tracing the Supply path upstream-to-downstream.',
       'Use the diagnostic path for the actual reject point instead of this TGW-entry diagnostic.',
       jsonb_build_object('facility','LVO','process','Inbound ASRS'),'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
cross join public.thinktank_entity_registry e
cross join public.thinktank_state_definitions st
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff' and e.canonical_key='ilpn' and st.state_key='ilpn:tgw-entry-reject'
on conflict (diagnostic_key) do update set
  symptom=excluded.symptom,check_order=excluded.check_order,process_node_id=excluded.process_node_id,
  entity_id=excluded.entity_id,expected_state_id=excluded.expected_state_id,check_instruction=excluded.check_instruction,
  evidence_to_observe=excluded.evidence_to_observe,if_pass=excluded.if_pass,if_fail=excluded.if_fail,
  scope=excluded.scope,authority=excluded.authority,confidence=excluded.confidence,status=excluded.status,updated_at=now();

insert into public.thinktank_diagnostic_checks
  (diagnostic_key,symptom,check_order,process_node_id,entity_id,check_instruction,evidence_to_observe,if_pass,if_fail,scope,authority,confidence,status)
select x.k,'Carton rejects at TGW entry after inbound scanner and before loop sorter scanner.',
       x.ord,n.id,e.id,x.instruction,x.evidence,x.pass,x.fail,
       jsonb_build_object('facility','LVO','process','Inbound ASRS','diagnostic_status','scaffold_until_troubleshooting-chat-confirmed'),
       'inferred',0.7,'active'
from public.thinktank_process_nodes n
cross join public.thinktank_entity_registry e
cross join (values
  ('lvo-inbound-asrs-entry-reject-02-wmos-to-cofe',20,
   'For the affected iLPN, verify the WMOS-to-Vargo/COFE handoff needed to support Inbound ASRS Supply processing.',
   'A timestamped record for the same iLPN showing the upstream handoff completed.',
   'Continue to the COFE-to-IBM-MQ Supply check.',
   'Failure boundary is at or before the WMOS-to-Vargo/COFE handoff; investigate that interface before TGW.'),
  ('lvo-inbound-asrs-entry-reject-03-cofe-to-mq',30,
   'Verify Vargo/COFE produced and placed the Supply message into IBM MQ for the same iLPN.',
   'Supply message for the iLPN is visible with a timestamp before carton arrival at the TGW entry point.',
   'Continue to IBM MQ-to-Neuron.',
   'Failure boundary is Vargo/COFE to IBM MQ.'),
  ('lvo-inbound-asrs-entry-reject-04-mq-to-neuron',40,
   'Verify the same Supply message traversed IBM MQ and was received/processed by Neuron.',
   'Matching iLPN/message appears on both sides of the IBM MQ-to-Neuron boundary with consistent timing.',
   'Continue to Neuron-to-Commander.',
   'Failure boundary is IBM MQ to Neuron.'),
  ('lvo-inbound-asrs-entry-reject-05-neuron-to-commander',50,
   'Verify Neuron forwarded the Supply message and TGW Commander received it for the affected iLPN.',
   'Commander contains the expected inbound Supply data for the iLPN before the physical carton reaches the TGW entry point.',
   'Continue to Commander-to-PLC.',
   'Failure boundary is Neuron to TGW Commander.'),
  ('lvo-inbound-asrs-entry-reject-06-commander-to-plc',60,
   'Verify Commander passed the required acceptance/routing control information to the PLC before the carton reached the TGW entry point.',
   'PLC/control-side evidence shows the carton had a valid route/acceptance state before arrival.',
   'The Supply chain completed; investigate PLC timing/state, physical controls or another entry-point condition.',
   'Failure boundary is Commander to PLC or the TGW internal handoff.')
) as x(k,ord,instruction,evidence,pass,fail)
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff' and e.canonical_key='ilpn'
on conflict (diagnostic_key) do update set
  symptom=excluded.symptom,check_order=excluded.check_order,process_node_id=excluded.process_node_id,
  entity_id=excluded.entity_id,check_instruction=excluded.check_instruction,evidence_to_observe=excluded.evidence_to_observe,
  if_pass=excluded.if_pass,if_fail=excluded.if_fail,scope=excluded.scope,authority=excluded.authority,
  confidence=excluded.confidence,status=excluded.status,updated_at=now();

insert into public.thinktank_embedding_queue (claim_id,status,attempts,queued_at)
select c.id,'pending',0,now()
from public.thinktank_process_claims c
where c.status='active'
  and c.claim_key in ('inbound-asrs-supply-message-chain','inbound-asrs-tgw-entry-boundary','lvo-inbound-asrs-entry-reject-symptom','lvo-inbound-asrs-entry-reject-supply-handoff-hypothesis')
  and c.embedding is null
on conflict (claim_id) do update set
  status=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.status else 'pending' end,
  queued_at=case when public.thinktank_embedding_queue.status='complete' then public.thinktank_embedding_queue.queued_at else now() end;

commit;
