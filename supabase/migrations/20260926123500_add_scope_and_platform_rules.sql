begin;

insert into public.thinktank_system_registry (canonical_key,name,system_type,role_description,metadata,status)
values
('google-cloud','Google Cloud','data_platform','Future enterprise data platform direction replacing Databricks; specific services and final architecture are not yet established in Process Memory.',jsonb_build_object('transition_from','databricks','architecture_status','direction_confirmed_services_unknown'),'planned'),
('gtp','GTP','picking_automation','Goods-to-person picking technology. Implementation and behavior are site-specific and must be scoped to the facility.',jsonb_build_object('site_specific',true),'active')
on conflict (canonical_key) do update set
  name=excluded.name,
  system_type=excluded.system_type,
  role_description=excluded.role_description,
  metadata=public.thinktank_system_registry.metadata || excluded.metadata,
  status=excluded.status,
  updated_at=now();

update public.thinktank_system_registry
set metadata=metadata || jsonb_build_object(
  'transition_status','planned_exit',
  'replacement_direction','google-cloud',
  'replacement_services','unknown'
), updated_at=now()
where canonical_key='databricks';

insert into public.thinktank_cortex_rules (rule_key,title,instruction,rationale,status,confidence)
values
('facility-scope-before-generalizing','Require facility scope before generalizing automation','For facility-dependent automation or picking technologies such as GTP, TGW, Exotec, Ocado/OSRS, or other site-specific implementations, identify the facility and implementation scope before applying configuration, behavior, troubleshooting logic, or process rules. Never promote a site-specific fact to a network-wide fact without explicit evidence.','Prevents facility-specific automation behavior from being treated as a Gap-wide operating standard.','approved',1.0),
('process-first-system-second','Anchor knowledge to durable process and objects','Organize reasoning around business process, operational objects, states, events, rules, and evidence first. Treat applications and platforms as implementations that can change over time. Preserve historical and planned system relationships rather than rewriting process knowledge when a platform changes.','Allows Process Memory to survive technology migrations such as the transition away from Databricks toward Google Cloud.','approved',1.0),
('trace-integration-boundaries','Trace source event destination and acknowledgement','When troubleshooting across systems, identify the source system, triggering event or message, interface, destination system, expected acknowledgement or state change, and observable evidence at each boundary before assigning a cause.','Separates source-generation failures, integration failures, destination rejection, and physical execution failures.','approved',1.0)
on conflict (rule_key) do update set
  title=excluded.title,
  instruction=excluded.instruction,
  rationale=excluded.rationale,
  status=excluded.status,
  confidence=excluded.confidence,
  updated_at=now();

commit;
