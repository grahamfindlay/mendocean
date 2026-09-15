create table private.dataset_state(singleton boolean primary key default true check(singleton),revision bigint not null default 0);
insert into private.dataset_state values(true,0);
alter table private.dataset_state enable row level security;
create function private.dataset_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update private.dataset_state set revision=revision+1 where singleton;
 if tg_op in ('UPDATE','DELETE') then update private.model_runs set status='retired' where status='active';end if;
 return null;
end $$;
create trigger reports_changed after insert or update or delete on public.reports for each statement execute function private.dataset_changed();
create trigger features_changed after insert or update or delete on private.weather_features for each statement execute function private.dataset_changed();
-- Snapshot revision and rows under one lock; changed data cannot later publish as current.
alter function public.service_query(text,jsonb) rename to service_query_worker;
create function public.service_query(action text,args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare revision bigint;
begin
 if action='training_snapshot' then
   select s.revision into revision from private.dataset_state s where singleton for share;
   return jsonb_build_object('revision',revision,'rows',public.service_query_base('training_data','{}'));
 elsif action='model_publish' then
   select s.revision into revision from private.dataset_state s where singleton for update;
   if not exists(select 1 from private.model_runs where id=(args->>'id')::uuid and (artifact->>'dataset_revision')::bigint=revision) then raise exception 'Training data changed; train a new shadow model before publishing';end if;
 end if;
 return public.service_query_worker(action,args);
end $$;
revoke all on function public.service_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query(text,jsonb) to service_role;
