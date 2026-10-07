-- Claim only the authenticated account's queued BHC work for an immediate
-- background import. The scheduled dispatcher remains the durable fallback.
create function public.claim_bhc_sync(uid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update private.jobs set status='pending',locked_at=null
 where user_id=uid and kind='bhc_sync' and status='running' and locked_at<now()-interval '10 minutes';
 with selected as (
  select j.id,c.revision from private.jobs j
  join private.bhc_connections c on c.user_id=j.user_id
  where j.user_id=uid and j.kind='bhc_sync' and j.status='pending'
   and j.due_at<=now() and j.expires_at>now()
   and c.revoked_at is null and c.access_state='active'
   and (c.expires_at is null or c.expires_at>now())
   and not exists(select 1 from private.jobs running where running.user_id=uid and running.kind='bhc_sync' and running.status='running')
  order by j.due_at,j.id limit 1 for update of j skip locked
 ), claimed as (
  update private.jobs j set status='running',locked_at=now(),attempts=attempts+1,
   payload=jsonb_build_object('revision',selected.revision)||j.payload
  from selected where j.id=selected.id returning j.*
 ) select to_jsonb(claimed) into result from claimed;
 return coalesce(result,'{}');
end $$;
revoke all on function public.claim_bhc_sync(uuid) from public,anon,authenticated;
grant execute on function public.claim_bhc_sync(uuid) to service_role;

-- Bind initial imports to the connection that created them, including when a
-- replacement occurs before the scheduled dispatcher claims the old job.
alter function public.service_query(text,jsonb) rename to service_query_before_immediate_bhc;
create function public.service_query(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.service_query_before_immediate_bhc(action,args);
 if action='connection_put' and result->>'saved'='true' then
  update private.jobs j set payload=j.payload||jsonb_build_object('revision',c.revision)
  from private.bhc_connections c where c.user_id=(args->>'user_id')::uuid
   and j.dedupe_key='bhc-initial:'||c.user_id||':'||(args->>'request_id');
 end if;
 return result;
end $$;
revoke all on function public.service_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query(text,jsonb) to service_role;
