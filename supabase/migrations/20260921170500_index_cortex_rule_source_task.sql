create index if not exists thinktank_cortex_rules_source_task_idx
on public.thinktank_cortex_rules(source_task_id)
where source_task_id is not null;
