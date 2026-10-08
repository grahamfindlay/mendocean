-- Server-only connection lifecycle. Imported history and reports are retained.
alter table private.bhc_connections
 add column method text not null default 'unknown' check(method in ('unknown','provided_token','password_exchange')),
 add column expires_at timestamptz,
 add column access_state text not null default 'active' check(access_state in ('active','reconnect_required','membership_missing')),
 add column import_status text not null default 'pending' check(import_status in ('pending','complete','failed')),
 add column last_attempt_at timestamptz,
 add column last_successful_sync_at timestamptz,
 add column revision bigint not null default 1;
alter table public.outing_members add column bhc_revision bigint;
create table private.bhc_settings(id boolean primary key default true check(id),club_id bigint not null check(club_id>0));
create table private.bhc_connect_requests(user_id uuid references public.profiles on delete cascade,request_id uuid,method text not null,started_at timestamptz not null default now(),status text not null default 'running' check(status in ('running','completed','failed')),primary key(user_id,request_id));
alter table private.bhc_settings enable row level security;
alter table private.bhc_connect_requests enable row level security;
create function private.guard_bhc_connection() returns trigger language plpgsql set search_path='' as $$
begin
 if new.revoked_at is null and (tg_op='INSERT' or new.club_id is distinct from old.club_id or new.ciphertext is distinct from old.ciphertext) then
  perform pg_advisory_xact_lock(hashtextextended(new.custid::text,719));
  if not exists(select 1 from private.bhc_settings where club_id=new.club_id) then raise exception 'Only configured Mendota membership is allowed';end if;
  if exists(select 1 from private.bhc_connections c where c.custid=new.custid and c.user_id<>new.user_id and c.revoked_at is null) then raise exception 'BHC account already connected';end if;
 end if;
 return new;
end $$;
create trigger guard_bhc_connection before insert or update on private.bhc_connections for each row execute function private.guard_bhc_connection();

alter function public.service_query(text,jsonb) rename to service_query_before_bhc_connection;
create function public.service_query(action text,args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; c private.bhc_connections; request private.bhc_connect_requests; uid uuid:=(args->>'user_id')::uuid; rid uuid:=(args->>'request_id')::uuid; count_attempts integer;
begin
 if action='bhc_config' then select to_jsonb(s) into result from private.bhc_settings s;
 elsif action='bhc_configure' then
  insert into private.bhc_settings(club_id) values((args->>'club_id')::bigint) on conflict(id) do nothing;
  if not exists(select 1 from private.bhc_settings where club_id=(args->>'club_id')::bigint) then raise exception 'Mendota configuration already pinned';end if;
  update private.bhc_connections set access_state='membership_missing' where club_id<>(args->>'club_id')::bigint;
 elsif action='bhc_connect_begin' then
  perform pg_advisory_xact_lock(hashtextextended(uid::text,710));
  delete from private.bhc_connect_requests where started_at<now()-interval '1 day';
  select * into request from private.bhc_connect_requests where user_id=uid and request_id=rid;
  if found then return jsonb_build_object('status',request.status);end if;
  select * into c from private.bhc_connections where user_id=uid for update;
  if c.sync_locked_until>now() or exists(select 1 from private.bhc_connect_requests where user_id=uid and status='running' and started_at>now()-interval '2 minutes') then return '{"status":"busy"}'::jsonb;end if;
  select count(*) into count_attempts from private.bhc_connect_requests where user_id=uid and method=args->>'method' and started_at>now()-interval '15 minutes';
  if count_attempts>=5 then return '{"status":"limited"}'::jsonb;end if;
  insert into private.bhc_connect_requests(user_id,request_id,method) values(uid,rid,args->>'method');
  update private.bhc_connections set sync_locked_until=now()+interval '2 minutes' where user_id=uid;
  return jsonb_build_object('status','started','revision',coalesce(c.revision,0),'custid',c.custid);
 elsif action='bhc_connect_fail' then
  update private.bhc_connect_requests set status='failed' where user_id=uid and request_id=rid and status='running';
  if found then update private.bhc_connections set sync_locked_until=null where user_id=uid and revision=(args->>'revision')::bigint and not exists(select 1 from private.bhc_connect_requests where user_id=uid and status='running' and started_at>now()-interval '2 minutes');end if;
 elsif action='connection_put' then
  perform pg_advisory_xact_lock(hashtextextended(uid::text,710));
  select * into c from private.bhc_connections where user_id=uid for update;
  if coalesce(c.revision,0)<>coalesce((args->>'revision')::bigint,0) then return '{"saved":false}'::jsonb;end if;
  if c.revoked_at is null and c.custid is not null and c.custid<>(args->>'custid')::bigint then return '{"saved":false,"different_account":true}'::jsonb;end if;
  perform pg_advisory_xact_lock(hashtextextended(args->>'custid',719));
  if exists(select 1 from private.bhc_connections where custid=(args->>'custid')::bigint and user_id<>uid and revoked_at is null) then return '{"saved":false,"already_linked":true}'::jsonb;end if;
  if rid is null or not exists(select 1 from private.bhc_connect_requests where user_id=uid and request_id=rid and status='running' and started_at>now()-interval '2 minutes') then return '{"saved":false}'::jsonb;end if;
  insert into private.bhc_connections(user_id,ciphertext,iv,custid,club_id,method,expires_at,revision)
  values(uid,args->>'ciphertext',args->>'iv',(args->>'custid')::bigint,(args->>'club_id')::bigint,args->>'method',(args->>'expires_at')::timestamptz,coalesce(c.revision,0)+1)
  on conflict(user_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,custid=excluded.custid,club_id=excluded.club_id,method=excluded.method,expires_at=excluded.expires_at,revision=excluded.revision,access_state='active',import_status='pending',last_error=null,sync_locked_until=null,revoked_at=null;
  update private.bhc_connect_requests set status='completed' where user_id=uid and request_id=rid;
  perform public.service_query_before_bhc_connection('enqueue',jsonb_build_object('kind','bhc_sync','user_id',uid,'due_at',now(),'expires_at',now()+interval '1 day','dedupe_key','bhc-initial:'||uid||':'||rid,'payload',jsonb_build_object('initial',true)));
  return '{"saved":true}'::jsonb;
 elsif action='connection_delete' then
  perform pg_advisory_xact_lock(hashtextextended(uid::text,710));
  update private.bhc_connect_requests set status='failed' where user_id=uid and status='running';
  -- Retain a revision tombstone while erasing all credentials. Old workers stay stale.
  update private.bhc_connections set ciphertext='',iv='',revoked_at=now(),revision=revision+1,sync_locked_until=null where user_id=uid;
  update private.jobs set status='cancelled' where user_id=uid and kind='bhc_sync' and status='pending';
 elsif action='connection_get' then
  update private.bhc_connections set access_state='reconnect_required' where user_id=uid and expires_at<=now() and access_state='active';
  update private.bhc_connections set access_state='membership_missing' where user_id=uid and exists(select 1 from private.bhc_settings where club_id<>private.bhc_connections.club_id);
  select to_jsonb(b) into result from private.bhc_connections b where user_id=uid and revoked_at is null;
 elsif action='connection_checked' then
  update private.bhc_connections set expires_at=(args->>'expires_at')::timestamptz where user_id=uid and revision=(args->>'revision')::bigint;
 elsif action='connection_problem' then
  update private.bhc_connections set access_state=coalesce(args->>'access_state',access_state),last_error=args->>'error',last_attempt_at=now(),import_status=case when args->>'access_state' is null then 'failed' else import_status end where user_id=uid and revision=(args->>'revision')::bigint;
 elsif action='connection_synced' then
  update private.bhc_connections set last_attempt_at=now(),last_error=args->>'error',import_status=case when args->>'error' is null then 'complete' else 'failed' end,last_sync=case when args->>'error' is null then now() else last_sync end,last_successful_sync_at=case when args->>'error' is null then now() else last_successful_sync_at end where user_id=uid and revision=(args->>'revision')::bigint;
  if found and args->>'error' is null then perform public.refresh_reminder_jobs(uid);end if;
 elsif action='sync_lock' then
  update private.bhc_connections set sync_locked_until=now()+interval '5 minutes' where user_id=uid and revoked_at is null and (args->>'revision' is null or revision=(args->>'revision')::bigint) and access_state='active' and (expires_at is null or expires_at>now()) and (sync_locked_until is null or sync_locked_until<now()) and not exists(select 1 from private.bhc_connect_requests where user_id=uid and status='running' and started_at>now()-interval '2 minutes');
  return jsonb_build_object('acquired',found);
 elsif action='sync_unlock' then
  update private.bhc_connections set sync_locked_until=null where user_id=uid and (args->>'revision' is null or revision=(args->>'revision')::bigint) and not exists(select 1 from private.bhc_connect_requests where user_id=uid and status='running' and started_at>now()-interval '2 minutes');
 elsif action='connections' then
  select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'last_sync',last_successful_sync_at)),'[]') into result from private.bhc_connections where revoked_at is null and access_state='active' and (expires_at is null or expires_at>now());
 else return public.service_query_before_bhc_connection(action,args);
 end if;
 return coalesce(result,'{}');
end $$;
revoke all on function public.service_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query(text,jsonb) to service_role;

-- Each import page applies under the connection row lock. Old revisions cannot
-- mutate outings/members or schedule reminders after replacement/disconnect.
create function public.apply_bhc_practice(uid uuid,revision bigint,practice jsonb,member jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare c private.bhc_connections; outing uuid; skipped boolean;
begin
 select * into c from private.bhc_connections where user_id=uid for update;
 if not found or c.revision<>apply_bhc_practice.revision or c.revoked_at is not null or c.access_state<>'active' or c.sync_locked_until is null or c.sync_locked_until<=now() or c.expires_at<=now() or not exists(select 1 from private.bhc_settings where club_id=c.club_id) or c.club_id<>(practice->>'bhc_club_id')::bigint then return null;end if;
 insert into public.outings(kind,bhc_club_id,bhc_practice_id,title,starts_at,ends_at,planned_coaches,planned_boats)
 values('official',c.club_id,(practice->>'bhc_practice_id')::bigint,practice->>'title',(practice->>'starts_at')::timestamptz,(practice->>'ends_at')::timestamptz,practice->'planned_coaches',practice->'planned_boats')
 on conflict(bhc_club_id,bhc_practice_id) do update set title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,planned_coaches=excluded.planned_coaches,planned_boats=excluded.planned_boats returning id into outing;
 select m.skipped into skipped from public.outing_members m where m.user_id=uid and m.outing_id=outing;
 insert into public.outing_members(outing_id,user_id,attendance,deadline,planned_boat,planned_seat,reminder,skipped,synced_at,bhc_revision)
 values(outing,uid,member->>'attendance',(member->>'deadline')::timestamptz,member->>'planned_boat',member->>'planned_seat',member->>'attendance'='attending' and not coalesce(skipped,false),coalesce(skipped,false),now(),c.revision)
 on conflict(outing_id,user_id) do update set attendance=excluded.attendance,deadline=excluded.deadline,planned_boat=excluded.planned_boat,planned_seat=excluded.planned_seat,reminder=excluded.reminder,skipped=excluded.skipped,synced_at=excluded.synced_at,bhc_revision=excluded.bhc_revision;
 return outing;
end $$;
revoke all on function public.apply_bhc_practice(uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.apply_bhc_practice(uuid,bigint,jsonb,jsonb) to service_role;

-- Used by reservation AND immediately before every email/push send.
alter function private.reminder_allowed(uuid,uuid,integer,text) rename to reminder_allowed_before_bhc;
create function private.reminder_allowed(uid uuid,outing uuid,gen integer,target_channel text) returns boolean language sql stable set search_path='' as $$
 select private.reminder_allowed_before_bhc(uid,outing,gen,target_channel) and exists(
 select 1 from public.outings o join public.outing_members m on m.outing_id=o.id and m.user_id=uid
 where o.id=outing and (o.kind='independent' or exists(select 1 from private.bhc_connections c join private.bhc_settings s on s.club_id=c.club_id
 where c.user_id=uid and c.revoked_at is null and c.access_state='active' and c.import_status='complete' and (c.expires_at is null or c.expires_at>now())
 and c.club_id=o.bhc_club_id and m.bhc_revision=c.revision and m.synced_at>=o.ends_at)))
$$;
-- SQL references bind to function OIDs; refresh existing callers to use the guard.
create or replace function public.reminder_channel_active(uid uuid,outing uuid,gen integer,target_channel text,token uuid,target_endpoint text default null) returns boolean language sql stable security definer set search_path='' as $$
 select private.reminder_allowed(uid,outing,gen,target_channel) and exists(select 1 from private.reminder_channels
 where user_id=uid and outing_id=outing and generation=gen and channel=target_channel and lease_token=token and locked_until>now() and sent_at is null)
 and (target_endpoint is null or exists(select 1 from private.push_subscriptions where user_id=uid and endpoint=target_endpoint))
$$;

create function public.apply_bhc_attendance_current(uid uuid,revision bigint,outing uuid,choice text,deadline timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.bhc_connections;
begin
 select * into c from private.bhc_connections where user_id=uid for update;
 if not found or c.revision<>apply_bhc_attendance_current.revision or c.revoked_at is not null or c.access_state<>'active' or c.sync_locked_until is null or c.sync_locked_until<=now() or c.expires_at<=now() then return false;end if;
 if not exists(select 1 from public.outings o join private.bhc_settings s on s.club_id=o.bhc_club_id where o.id=outing and o.bhc_club_id=c.club_id) then return false;end if;
 perform public.apply_bhc_attendance(uid,outing,choice,deadline);
 update public.outing_members m set bhc_revision=c.revision where m.user_id=uid and m.outing_id=outing;
 return true;
end $$;
revoke all on function public.apply_bhc_attendance_current(uuid,bigint,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_bhc_attendance_current(uuid,bigint,uuid,text,timestamptz) to service_role;
