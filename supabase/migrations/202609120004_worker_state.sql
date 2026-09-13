alter table private.bhc_connections add column sync_locked_until timestamptz;
create table private.deliveries(user_id uuid references public.profiles on delete cascade,outing_id uuid references public.outings on delete cascade,channel text not null,reserved_at timestamptz not null default now(),sent_at timestamptz,primary key(user_id,outing_id));
alter table private.deliveries enable row level security;
-- Extend the service dispatcher without exposing private tables through PostgREST.
alter function public.service_query(text,jsonb) rename to service_query_base;
create function public.service_query(action text,args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; n integer;
begin
 if action='sync_lock' then
   update private.bhc_connections set sync_locked_until=now()+interval '5 minutes' where user_id=(args->>'user_id')::uuid and (sync_locked_until is null or sync_locked_until<now());
   return jsonb_build_object('acquired',found);
 elsif action='sync_unlock' then update private.bhc_connections set sync_locked_until=null where user_id=(args->>'user_id')::uuid;
 elsif action='delivery_reserve' then
   perform pg_advisory_xact_lock(846302);
   select to_jsonb(d) into result from private.deliveries d where user_id=(args->>'user_id')::uuid and outing_id=(args->>'outing_id')::uuid;
   if found then return jsonb_build_object('allowed',result->>'sent_at' is null,'channel',result->>'channel');end if;
   if args->>'channel'='email' then
     select count(*) into n from private.deliveries where channel='email' and coalesce(sent_at,reserved_at)>=date_trunc('day',now());
     if n>=80 then return '{"allowed":false,"quota":true}'::jsonb;end if;
   end if;
   insert into private.deliveries(user_id,outing_id,channel) values((args->>'user_id')::uuid,(args->>'outing_id')::uuid,args->>'channel');return jsonb_build_object('allowed',true,'channel',args->>'channel');
 elsif action='delivery_sent' then update private.deliveries set sent_at=now() where user_id=(args->>'user_id')::uuid and outing_id=(args->>'outing_id')::uuid;
 elsif action='model_publish' then
   perform pg_advisory_xact_lock(846303);
   if not exists(select 1 from private.model_runs where id=(args->>'id')::uuid and artifact->>'eligible'='true') then raise exception 'Model has not passed eligibility checks';end if;
   update private.model_runs set status='retired' where status='active';
   update private.model_runs set status='active' where id=(args->>'id')::uuid;
   insert into private.audit(actor,event,details) values((args->>'actor')::uuid,'model_published',jsonb_build_object('id',args->>'id'));
 elsif action='model_rollback' then update private.model_runs set status='retired' where status='active';
 elsif action='model_active' then select artifact into result from private.model_runs where status='active';
 else return public.service_query_base(action,args);
 end if;
 return coalesce(result,'{}');
end $$;
revoke all on function public.service_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query(text,jsonb) to service_role;
