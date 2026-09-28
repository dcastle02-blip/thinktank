-- Capture vendor-screen observability boundary for LVO Inbound ASRS troubleshooting.
-- Exact clearing screen/tool and persistence location remain unknown to local Process Implementation.
-- Diagnostics should escalate evidence capture to the support/vendor team rather than asking local users to perform inaccessible checks.

begin;

insert into public.thinktank_process_claims
  (claim_key,subject_node_id,claim_type,statement,structured,scope,authority,confidence,status)
select
  'lvo-inbound-asrs-vendor-screen-observability-boundary',
  n.id,'exception',
  'For the LVO Inbound ASRS stale-message recovery process, the exact screen or tool used by the vendor/support team to inspect and clear old error/reroute messages is not visible to the local Process Implementation user. The specific clearing interface and persistence location therefore remain unknown and should not be inferred.',
  jsonb_build_object('local_visibility','no access to vendor/support screens','unknowns',jsonb_build_array('exact clearing screen/tool','exact persistence location','exact cleanup command/procedure'),'diagnostic_implication','escalate evidence request to vendor/support team rather than asking local user to perform inaccessible checks'),
  jsonb_build_object('facility','LVO','process','Inbound ASRS','incident_family','message delay / reject'),
  'confirmed_operational',1.0,'active'
from public.thinktank_process_nodes n
where n.canonical_key='node:inbound-asrs-tgw-entry-handoff'
and not exists (select 1 from public.thinktank_process_claims c where c.claim_key='lvo-inbound-asrs-vendor-screen-observability-boundary' and c.status='active');

insert into public.thinktank_process_evidence(claim_id,source_type,source_ref,excerpt,metadata)
select c.id,'manual','Operational clarification 2026-09-28',
       'Dylan: I do not know what screen/tool they clear the messages from because I do not get to see their screens.',
       jsonb_build_object('evidence_class','operator-confirmed access boundary')
from public.thinktank_process_claims c
where c.claim_key='lvo-inbound-asrs-vendor-screen-observability-boundary' and c.status='active'
and not exists (select 1 from public.thinktank_process_evidence e where e.claim_id=c.id and e.source_ref='Operational clarification 2026-09-28');

update public.thinktank_diagnostic_checks
set check_instruction='Before clearing or restarting anything, have the team with Neuron/TGW vendor-screen access capture the accumulated old error and reroute messages associated with carrier loads. Record message counts, timestamps, affected identifiers and the queue/store location if visible. If local Ops/Process Implementation cannot access those screens, escalate the evidence request rather than asking them to perform the check.',
    evidence_to_observe='Vendor/support evidence showing presence or absence of stale/backlogged error and reroute messages, message age, affected carrier-load identifiers, and the actual queue/store or application view where they are held.',
    if_pass='Preserve the evidence, then follow the vendor/support recovery procedure to clear the stale messages and verify whether inbound flow resumes.',
    if_fail='Continue tracing message timing through the known integration boundaries; do not infer that Neuron or MongoDB is the source without evidence.',
    updated_at=now()
where diagnostic_key='lvo-inbound-asrs-entry-reject-045-check-stale-error-reroute-backlog';

commit;
