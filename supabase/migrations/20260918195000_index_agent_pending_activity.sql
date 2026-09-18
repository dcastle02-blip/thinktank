create index if not exists thinktank_agent_tasks_pending_activity_idx
  on public.thinktank_agent_tasks (pending_activity_id)
  where pending_activity_id is not null;
