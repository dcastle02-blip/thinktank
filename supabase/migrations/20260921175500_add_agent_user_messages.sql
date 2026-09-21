begin;

alter table public.thinktank_agent_steps
  drop constraint if exists thinktank_agent_steps_actor_check;

alter table public.thinktank_agent_steps
  add constraint thinktank_agent_steps_actor_check
  check (actor = any (array['Dylan'::text,'GPT'::text,'Claude'::text,'System'::text]));

alter table public.thinktank_agent_steps
  drop constraint if exists thinktank_agent_steps_kind_check;

alter table public.thinktank_agent_steps
  add constraint thinktank_agent_steps_kind_check
  check (kind = any (array['message'::text,'model'::text,'tool'::text,'checkpoint'::text,'system'::text]));

commit;
