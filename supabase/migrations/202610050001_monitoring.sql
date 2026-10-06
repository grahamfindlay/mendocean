-- Activity contains outcomes and identifiers, never report/provider payloads.
create table private.monitoring_state (
 id boolean primary key default true check(id), started_at timestamptz not null default now(),
 last_tick_started_at timestamptz, last_tick_completed_at timestamptz, last_cleanup_at timestamptz
);
insert into private.monitoring_state(id) values(true);
create table private.user_observations (
 user_id uuid primary key references public.profiles on delete cascade,
 first_at timestamptz not null default now(), last_at timestamptz not null default now(),
 last_foreground_at timestamptz
);
create table private.activity (
 id bigint generated always as identity primary key, at timestamptz not null default now(),
 user_id uuid not null references public.profiles on delete cascade,
 event text not null check(event in ('app_observed','report_created','report_edited','report_deleted','bhc_connected','bhc_disconnected','bhc_synced','bhc_sync_failed','reminder_preferences_changed','job_retry','job_failed','api_failed')),
 details jsonb not null default '{}'
);
create index activity_user_time on private.activity(user_id,at desc,id desc);
create table private.activity_days (
 day date not null, user_id uuid references public.profiles on delete cascade,
 reports_created integer not null default 0, reports_edited integer not null default 0,
 reports_deleted integer not null default 0, primary key(day,user_id)
);
create table private.operational_events (
 id bigint generated always as identity primary key, at timestamptz not null default now(),
 user_id uuid references public.profiles on delete set null, request_id uuid,
 operation text not null, outcome text not null check(outcome in ('failed','retry','done'))
);
create index operational_events_time on private.operational_events(at desc);
create table private.owner_digests (
 week date primary key, created_at timestamptz not null default now(),
 payload jsonb not null, lease uuid, locked_until timestamptz, sent_at timestamptz
);
alter table private.monitoring_state enable row level security;
alter table private.user_observations enable row level security;
alter table private.activity enable row level security;
alter table private.activity_days enable row level security;
alter table private.operational_events enable row level security;
alter table private.owner_digests enable row level security;
revoke all on private.monitoring_state,private.user_observations,private.activity,private.activity_days,private.operational_events,private.owner_digests from public,anon,authenticated;

create function private.record_activity(uid uuid, name text, metadata jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=uid) then return;end if;
 insert into private.activity(user_id,event,details) values(uid,name,metadata);
 -- Background syncs and failed requests are diagnostics, not evidence of human use.
 if name in ('bhc_synced','bhc_sync_failed','job_retry','job_failed','api_failed') then return;end if;
 insert into private.user_observations(user_id) values(uid)
 on conflict(user_id) do update set last_at=now();
 insert into private.activity_days(day,user_id,reports_created,reports_edited,reports_deleted)
 values((now() at time zone 'America/Chicago')::date,uid,
  (name='report_created')::integer,(name='report_edited')::integer,(name='report_deleted')::integer)
 on conflict(day,user_id) do update set
  reports_created=private.activity_days.reports_created+excluded.reports_created,
  reports_edited=private.activity_days.reports_edited+excluded.reports_edited,
  reports_deleted=private.activity_days.reports_deleted+excluded.reports_deleted;
end $$;

create function private.report_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then
  -- Do not manufacture user deletes during account/outing cascades.
  if auth.uid()=old.user_id and pg_trigger_depth()=1 then perform private.record_activity(old.user_id,'report_deleted');end if;
 elsif tg_op='INSERT' then perform private.record_activity(new.user_id,'report_created');
 elsif old.outing_id=new.outing_id and old.data is distinct from new.data then
  perform private.record_activity(new.user_id,'report_edited');
 end if;
 return null;
end $$;
create trigger report_activity after insert or update or delete on public.reports for each row execute function private.report_activity();
create function private.preference_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.reminder_channels is distinct from new.reminder_channels or old.reminders_paused is distinct from new.reminders_paused then
  perform private.record_activity(new.id,'reminder_preferences_changed');
 end if;
 return null;
end $$;
create trigger preference_activity after update on public.profiles for each row execute function private.preference_activity();
create function private.bhc_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform private.record_activity(new.user_id,'bhc_connected');
 elsif tg_op='DELETE' then
  if pg_trigger_depth()=1 then perform private.record_activity(old.user_id,'bhc_disconnected');end if;
 elsif new.revoked_at is not null and old.revoked_at is null then perform private.record_activity(new.user_id,'bhc_disconnected');
 elsif new.ciphertext is distinct from old.ciphertext then perform private.record_activity(new.user_id,'bhc_connected');
 elsif new.last_sync is distinct from old.last_sync then
  perform private.record_activity(new.user_id,case when new.last_error is null then 'bhc_synced' else 'bhc_sync_failed' end);
 end if;
 return null;
end $$;
create trigger bhc_activity after insert or update or delete on private.bhc_connections for each row execute function private.bhc_activity();
create function private.job_observation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='running' and new.status in ('done','failed','pending') and new.kind in ('weather','bhc_sync','reminder','enrich') and (new.status<>'pending' or (new.last_error is not null and new.attempts>=old.attempts)) then
  insert into private.operational_events(user_id,operation,outcome) values(new.user_id,new.kind,
   case new.status when 'pending' then 'retry' when 'failed' then 'failed' else 'done' end);
  if new.user_id is not null and new.status in ('pending','failed') then
   perform private.record_activity(new.user_id,case new.status when 'pending' then 'job_retry' else 'job_failed' end,jsonb_build_object('operation',new.kind));
  end if;
 end if;
 return null;
end $$;
create trigger job_observation after update on private.jobs for each row execute function private.job_observation();
revoke all on function private.record_activity(uuid,text,jsonb),private.report_activity(),private.preference_activity(),private.bhc_activity(),private.job_observation() from public,anon,authenticated;

-- Only the service role can call this RPC. HTTP routes enforce owner/member/monitor gates.
create function public.monitoring_query(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; uid uuid; span integer; observation_at timestamptz:=coalesce((args->>'at')::timestamptz,now());
 start_time timestamptz; end_time timestamptz; cutoff date; current_week date; token uuid; digest_record private.owner_digests;
begin
 if action='observe' then
  uid:=(args->>'user_id')::uuid;
  if not exists(select 1 from public.profiles where id=uid and approved) then raise exception 'Invitation required';end if;
  insert into private.user_observations(user_id,last_foreground_at) values(uid,now())
  on conflict(user_id) do update set last_at=now(),last_foreground_at=now()
  where private.user_observations.last_foreground_at is null or private.user_observations.last_foreground_at<now()-interval '15 minutes';
  if found then perform private.record_activity(uid,'app_observed');end if;
 elsif action='api_failure' then
  if args->>'operation' not in ('weather','assessment','account','report','report/delete','settings','outing','bhc/attendance','bhc/connect','bhc/disconnect','bhc/sync','push','admin','unknown','dispatcher') then raise exception 'Invalid operation';end if;
  insert into private.operational_events(user_id,request_id,operation,outcome)
  values((args->>'user_id')::uuid,(args->>'request_id')::uuid,args->>'operation','failed');
  if args->>'user_id' is not null then perform private.record_activity((args->>'user_id')::uuid,'api_failed',jsonb_build_object('operation',args->>'operation','request_id',args->>'request_id'));end if;
 elsif action='tick_started' then update private.monitoring_state set last_tick_started_at=observation_at where id=true;
 elsif action='tick_completed' then
  update private.monitoring_state set last_tick_completed_at=observation_at where id=true;
  if (select last_cleanup_at is null or last_cleanup_at<observation_at-interval '1 day' from private.monitoring_state) then
   -- Delete bounded batches; repeated daily runs clear the tail without a long tick.
   delete from private.activity where id in(select id from private.activity where at<observation_at-interval '90 days' limit 5000);
   delete from private.operational_events where id in(select id from private.operational_events where at<observation_at-interval '30 days' limit 5000);
   delete from private.activity_days where day<(observation_at at time zone 'America/Chicago')::date-366;
   delete from private.owner_digests where created_at<observation_at-interval '90 days';
   update private.monitoring_state set last_cleanup_at=observation_at where id=true;
  end if;
 elsif action='operations' then
  select jsonb_build_object('started_at',s.started_at,'last_tick_started_at',s.last_tick_started_at,'last_tick_completed_at',s.last_tick_completed_at,
   'last_weather',(select max(fetched_at) from public.weather_runs),
   'overdue_jobs',(select count(*) from private.jobs where expires_at>observation_at and
    ((status='pending' and due_at<observation_at-interval '15 minutes') or (status='running' and locked_at<observation_at-interval '15 minutes'))),
   'retries_24h',(select count(*) from private.operational_events where at>=observation_at-interval '24 hours' and outcome='retry'),
   'failed_jobs_24h',(select count(*) from private.operational_events where at>=observation_at-interval '24 hours' and outcome='failed' and operation in ('weather','bhc_sync','reminder','enrich')),
   'api_failures_15m',(select count(*) from private.operational_events where at>=observation_at-interval '15 minutes' and outcome='failed' and request_id is not null),
   'api_affected_users_15m',(select count(distinct user_id) from private.operational_events where at>=observation_at-interval '15 minutes' and outcome='failed' and request_id is not null),
   'bhc_problems',(select count(*) from private.bhc_connections where revoked_at is null and (last_error is not null or coalesce(last_sync,s.started_at)<observation_at-interval '27 hours')),
   'reminder_problems',(select count(*) from private.reminder_channels c join private.deliveries d using(user_id,outing_id,generation)
    where c.sent_at is null and c.last_error is not null and d.reserved_at>=observation_at-interval '7 days'),
   'recent_events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from(select at,user_id,request_id,operation,outcome from private.operational_events order by at desc,id desc limit 30)e))
  into result from private.monitoring_state s;
 elsif action='activity' then
  span:=least(30,greatest(1,coalesce((args->>'days')::integer,7)));
  cutoff:=(observation_at at time zone 'America/Chicago')::date-span+1;
  select jsonb_build_object('started_at',(select started_at from private.monitoring_state),'days',span,
   'users',coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'role',p.role,'approved',p.approved,'invited_at',p.created_at,
    'first_observed_at',u.first_at,'last_observed_at',u.last_at,
    'report_count',(select count(*) from public.reports where user_id=p.id),
    'reports_created',(select coalesce(sum(reports_created),0) from private.activity_days where user_id=p.id and day>=cutoff),
    'last_report_at',(select max(updated_at) from public.reports where user_id=p.id),
    'bhc_connected',coalesce(b.revoked_at is null and b.user_id is not null,false),'last_sync',b.last_sync,'bhc_problem',b.last_error is not null or (b.user_id is not null and b.revoked_at is null and coalesce(b.last_sync,(select started_at from private.monitoring_state))<observation_at-interval '27 hours'),
    'reminder_problem',exists(select 1 from private.reminder_channels c join private.deliveries d using(user_id,outing_id,generation) where c.user_id=p.id and c.sent_at is null and c.last_error is not null and d.reserved_at>=observation_at-interval '7 days'),
    'reminder_channels',p.reminder_channels,'reminders_paused',p.reminders_paused) order by u.last_at desc nulls last,p.created_at),'[]'))
  into result from public.profiles p left join private.user_observations u on u.user_id=p.id left join private.bhc_connections b on b.user_id=p.id;
  result:=result||jsonb_build_object('summary',public.monitoring_query('summary',jsonb_build_object('start',cutoff::timestamp at time zone 'America/Chicago','end',(((observation_at at time zone 'America/Chicago')::date+1)::timestamp at time zone 'America/Chicago'))));
 elsif action='timeline' then
  uid:=(args->>'user_id')::uuid;
  select jsonb_build_object('events',coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]')) into result
  from(select id,at,event,details from private.activity where user_id=uid and id<coalesce((args->>'before')::bigint,9223372036854775807) order by id desc limit 50)e;
 elsif action='summary' then
  start_time:=(args->>'start')::timestamptz;end_time:=(args->>'end')::timestamptz;
  if start_time is null or end_time is null or end_time<=start_time or end_time-start_time>interval '32 days' then raise exception 'Invalid summary window';end if;
  select jsonb_build_object('started_at',(select started_at from private.monitoring_state),'start',start_time,'end',end_time,
   'active_users',(select count(distinct a.user_id) from private.activity_days a join public.profiles p on p.id=a.user_id where p.role<>'admin' and a.day>=(start_time at time zone 'America/Chicago')::date and a.day<(end_time at time zone 'America/Chicago')::date),
   'returning_users',(select count(distinct a.user_id) from private.activity_days a join public.profiles p on p.id=a.user_id where p.role<>'admin' and a.day>=(start_time at time zone 'America/Chicago')::date and a.day<(end_time at time zone 'America/Chicago')::date and exists(select 1 from private.activity_days prev where prev.user_id=a.user_id and prev.day>=(start_time at time zone 'America/Chicago')::date-((end_time at time zone 'America/Chicago')::date-(start_time at time zone 'America/Chicago')::date) and prev.day<(start_time at time zone 'America/Chicago')::date)),
   'reports_created',coalesce(sum(a.reports_created),0),'reports_edited',coalesce(sum(a.reports_edited),0),'reports_deleted',coalesce(sum(a.reports_deleted),0),
   'contributors',count(distinct a.user_id) filter(where a.reports_created>0),
   'bhc_connected',(select count(*) from private.activity x join public.profiles bp on bp.id=x.user_id where bp.role<>'admin' and x.event='bhc_connected' and x.at>=start_time and x.at<end_time))
  into result from private.activity_days a join public.profiles p on p.id=a.user_id
  where p.role<>'admin' and a.day>=(start_time at time zone 'America/Chicago')::date and a.day<(end_time at time zone 'America/Chicago')::date;
 elsif action='digest_reserve' then
  current_week:=(args->>'week')::date;
  perform pg_advisory_xact_lock(846305);
  insert into private.owner_digests(week,payload) values(current_week,args->'payload') on conflict do nothing;
  select * into digest_record from private.owner_digests where week=current_week for update;
  if digest_record.sent_at is not null or digest_record.created_at<now()-interval '23 hours' or digest_record.locked_until>now() then return '{"allowed":false}';end if;
  token:=gen_random_uuid();
  update private.owner_digests set lease=token,locked_until=now()+interval '5 minutes' where week=current_week;
  return jsonb_build_object('allowed',true,'lease',token,'payload',digest_record.payload);
 elsif action='digest_finish' then
  update private.owner_digests set sent_at=case when (args->>'sent')::boolean then now() else null end,locked_until=null
  where week=(args->>'week')::date and lease=(args->>'lease')::uuid;
 else raise exception 'Unknown monitoring action';
 end if;
 return coalesce(result,'{}');
end $$;
revoke all on function public.monitoring_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.monitoring_query(text,jsonb) to service_role;
