-- Weather evidence is service-only. User routes separately check outing membership.
create table private.observation_sources (
 source text primary key check(source in ('buoy','iem_msn','vc_jmp')),
 enabled_at timestamptz not null default now(), last_attempt timestamptz, last_success timestamptz,
 latest_observed_at timestamptz, failures integer not null default 0, last_error text,
 slot bigint, locked_until timestamptz, lease uuid,
 trial_ends_at timestamptz, review_due boolean not null default false
);
create table private.observation_captures (
 id uuid primary key, source text not null references private.observation_sources,
 received_at timestamptz not null, object_path text unique, error text
);
create index observation_capture_time on private.observation_captures(received_at);
create table private.observation_summaries (
 source text not null references private.observation_sources, starts_at timestamptz not null,
 data jsonb not null, revision integer not null default 1, first_received_at timestamptz not null,
 primary key(source,starts_at)
);
create index observation_summary_time on private.observation_summaries(starts_at);
create table private.observation_bundles (
 day date primary key, object_path text not null unique, archived_at timestamptz not null default now()
);
create table private.outing_measurements (
 outing_id uuid primary key references public.outings on delete cascade,
 starts_at timestamptz not null, ends_at timestamptz not null, data jsonb not null,
 updated_at timestamptz not null default now()
);
create table private.report_weather (
 report_id uuid primary key references public.reports on delete cascade,
 starts_at timestamptz not null, ends_at timestamptz not null, measurements jsonb, forecast jsonb, source_kind text, run_id uuid references public.weather_runs, updated_at timestamptz not null default now()
);
alter table private.report_weather enable row level security;
revoke all on private.report_weather from public,anon,authenticated;
alter table private.observation_sources enable row level security;
alter table private.observation_captures enable row level security;
alter table private.observation_summaries enable row level security;
alter table private.observation_bundles enable row level security;
alter table private.outing_measurements enable row level security;
revoke all on private.observation_sources,private.observation_captures,private.observation_summaries,private.observation_bundles,private.outing_measurements from public,anon,authenticated;

create function public.observation_query(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; item jsonb; t timestamptz:=coalesce((args->>'at')::timestamptz,now());
 src text:=args->>'source'; token uuid; source_state private.observation_sources; day_to_archive date;
begin
 if action='reserve' then
  if src not in ('buoy','iem_msn','vc_jmp') then raise exception 'Invalid source';end if;
  insert into private.observation_sources(source,enabled_at,trial_ends_at)
  values(src,t,case when src='vc_jmp' then t+interval '60 days' end) on conflict do nothing;
  select * into source_state from private.observation_sources where source=src for update;
  if source_state.trial_ends_at<=t then
   update private.observation_sources set review_due=true where source=src;
   return '{"acquired":false,"review_due":true}';
  end if;
  if source_state.locked_until>t or (source_state.slot=(args->>'slot')::bigint and source_state.last_error is null and not coalesce((args->>'backfill')::boolean,false)) then return '{"acquired":false}';end if;
  token:=gen_random_uuid();
  update private.observation_sources set last_attempt=t,locked_until=t+interval '5 minutes',lease=token where source=src;
  return jsonb_build_object('acquired',true,'lease',token);
 elsif action='commit' then
  select * into source_state from private.observation_sources where source=src and lease=(args->>'lease')::uuid for update;
  if not found then raise exception 'Collection lease lost';end if;
  insert into private.observation_captures(id,source,received_at,object_path,error) values((args->>'id')::uuid,src,t,args->>'object_path',args->>'partial_error');
  for item in select jsonb_array_elements(args->'rows') loop
   if item->>'source'<>src or (item->>'end')::timestamptz>t then raise exception 'Invalid observation summary';end if;
   insert into private.observation_summaries(source,starts_at,data,first_received_at)
   values(src,(item->>'start')::timestamptz,item,t)
   on conflict(source,starts_at) do update set data=excluded.data,revision=private.observation_summaries.revision+1
   where (excluded.data->>'sample_count')::integer >= (private.observation_summaries.data->>'sample_count')::integer
    and (excluded.data-'received_at'-'raw_paths') is distinct from (private.observation_summaries.data-'received_at'-'raw_paths');
  end loop;
  update private.observation_sources set last_success=t,
   latest_observed_at=greatest(latest_observed_at,(args->>'latest_observed_at')::timestamptz),
   failures=case when args->>'partial_error' is null then 0 else failures+1 end,last_error=args->>'partial_error',locked_until=null,lease=null,
   slot=case when coalesce((args->>'backfill')::boolean,false) then slot else (args->>'slot')::bigint end where source=src;
 elsif action='error' then
  update private.observation_sources set failures=failures+1,last_error=args->>'error',locked_until=null,lease=null
  where source=src and lease=(args->>'lease')::uuid;
  if found then insert into private.observation_captures(id,source,received_at,object_path,error)
   values((args->>'id')::uuid,src,t,args->>'object_path',args->>'error');end if;
 elsif action='health' then
  return jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(s)-'lease'-'locked_until'),'[]') from private.observation_sources s),
   'database_bytes',pg_database_size(current_database()),
   'storage_bytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects),
   'archive_days',(select count(*) from private.observation_bundles),
   'unenriched_reports',(select count(*) from public.reports r where not exists(select 1 from private.report_weather rw where rw.report_id=r.id and rw.measurements is not null)));
 elsif action='window' then
  if (args->>'end')::timestamptz<=(args->>'start')::timestamptz or (args->>'end')::timestamptz-(args->>'start')::timestamptz>interval '14 days' then raise exception 'Invalid window';end if;
  return jsonb_build_object('rows',(select coalesce(jsonb_agg(data||jsonb_build_object('revision',revision,'first_received_at',first_received_at) order by starts_at),'[]') from private.observation_summaries where starts_at>=(args->>'start')::timestamptz-interval '5 minutes' and starts_at<(args->>'end')::timestamptz),
   'bundles',(select coalesce(jsonb_agg(object_path),'[]') from private.observation_bundles where day>=(((args->>'start')::timestamptz-interval '5 minutes') at time zone 'UTC')::date and day<=((args->>'end')::timestamptz at time zone 'UTC')::date));
 elsif action='measurements_put' then
  perform 1 from public.outings where id=(args->>'outing_id')::uuid and coalesce(actual_starts_at,starts_at)=(args->>'start')::timestamptz and coalesce(actual_ends_at,ends_at)=(args->>'end')::timestamptz for share;
  if not found then raise exception 'Outing interval changed';end if;
  insert into private.outing_measurements(outing_id,starts_at,ends_at,data) values((args->>'outing_id')::uuid,(args->>'start')::timestamptz,(args->>'end')::timestamptz,args->'data')
  on conflict(outing_id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,data=excluded.data,updated_at=t
  where private.outing_measurements.data is distinct from excluded.data or private.outing_measurements.starts_at<>excluded.starts_at or private.outing_measurements.ends_at<>excluded.ends_at;
 elsif action in ('report_measurements_put','report_forecast_put') then
  perform 1 from public.reports r join public.outings o on o.id=r.outing_id where r.id=(args->>'report_id')::uuid
   and coalesce(o.actual_starts_at,(r.data->>'actual_start')::timestamptz,o.starts_at)=(args->>'start')::timestamptz
   and coalesce(o.actual_ends_at,(r.data->>'actual_end')::timestamptz,o.ends_at)=(args->>'end')::timestamptz for share;
  if not found then raise exception 'Report interval changed';end if;
  insert into private.report_weather(report_id,starts_at,ends_at) values((args->>'report_id')::uuid,(args->>'start')::timestamptz,(args->>'end')::timestamptz)
  on conflict(report_id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,
   measurements=case when private.report_weather.starts_at=excluded.starts_at and private.report_weather.ends_at=excluded.ends_at then private.report_weather.measurements end,
   forecast=case when private.report_weather.starts_at=excluded.starts_at and private.report_weather.ends_at=excluded.ends_at then private.report_weather.forecast end,
   source_kind=case when private.report_weather.starts_at=excluded.starts_at and private.report_weather.ends_at=excluded.ends_at then private.report_weather.source_kind end,
   run_id=case when private.report_weather.starts_at=excluded.starts_at and private.report_weather.ends_at=excluded.ends_at then private.report_weather.run_id end;
  if action='report_measurements_put' then update private.report_weather set measurements=args->'data',updated_at=t where report_id=(args->>'report_id')::uuid;
  else update private.report_weather set forecast=args->'features',source_kind=args->>'source_kind',run_id=(args->>'run_id')::uuid where report_id=(args->>'report_id')::uuid;end if;
 elsif action='own_measurements' then
  return coalesce((select jsonb_agg(jsonb_build_object('outing_id',r.outing_id,'conditions',w.measurements||jsonb_build_object('forecast',w.forecast,'forecast_source_kind',w.source_kind),'updated_at',w.updated_at))
   from private.report_weather w join public.reports r on r.id=w.report_id join public.outings o on o.id=r.outing_id
   where r.user_id=(args->>'user_id')::uuid and w.starts_at=coalesce(o.actual_starts_at,(r.data->>'actual_start')::timestamptz,o.starts_at)
    and w.ends_at=coalesce(o.actual_ends_at,(r.data->>'actual_end')::timestamptz,o.ends_at) and w.measurements is not null),'[]');
 elsif action='repair_candidates' then
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'ends_at',coalesce(o.actual_ends_at,o.ends_at))) from
   (select distinct o.* from public.outings o join public.reports r on r.outing_id=o.id left join private.outing_measurements m on m.outing_id=o.id
    where coalesce(o.actual_ends_at,o.ends_at)<t and (m.outing_id is null or not exists(select 1 from private.report_weather rw where rw.report_id=r.id and rw.measurements is not null) or m.updated_at<t-interval '6 hours' and coalesce(o.actual_ends_at,o.ends_at)>t-interval '7 days')
    order by o.starts_at desc limit 25)o),'[]');
 elsif action='archive_candidate' then
  select (min(starts_at) at time zone 'UTC')::date into day_to_archive from private.observation_summaries where starts_at<(date_trunc('day',t at time zone 'UTC') at time zone 'UTC')-interval '90 days';
  return jsonb_build_object('day',day_to_archive,'rows',(select coalesce(jsonb_agg(data||jsonb_build_object('revision',revision,'first_received_at',first_received_at) order by starts_at,source),'[]') from private.observation_summaries where (starts_at at time zone 'UTC')::date=day_to_archive));
 elsif action='archive_commit' then
  -- The caller uploads and reads back the immutable bundle before committing.
  -- Freeze writers briefly and reject a bundle made stale by a concurrent correction.
  lock table private.observation_summaries in share row exclusive mode;
  select coalesce(jsonb_agg(data||jsonb_build_object('revision',revision,'first_received_at',first_received_at) order by starts_at,source),'[]') into result
   from private.observation_summaries where (starts_at at time zone 'UTC')::date=(args->>'day')::date;
  if result is distinct from args->'rows' or result='[]'::jsonb then raise exception 'Observation archive snapshot changed';end if;
  insert into private.observation_bundles(day,object_path) values((args->>'day')::date,args->>'object_path');
  delete from private.observation_summaries where (starts_at at time zone 'UTC')::date=(args->>'day')::date;
  result:='{}';
 elsif action='cleanup' then
  -- Raw files are retained until the owner's explicit retention review.
  delete from private.observation_captures where id in(select id from private.observation_captures where received_at<t-interval '90 days' limit 2000);
  delete from private.jobs where id in(select id from private.jobs where (kind like 'observations%' or kind in ('weather','enrich')) and status in ('done','failed','cancelled') and expires_at<t-interval '30 days' limit 2000);
 elsif action='vc_trial' then
  if coalesce((args->>'days')::integer,-1) not between 0 and 60 then raise exception 'Invalid trial length';end if;
  insert into private.observation_sources(source,enabled_at,trial_ends_at,review_due) values('vc_jmp',t,t+make_interval(days=>(args->>'days')::integer),(args->>'days')::integer=0)
  on conflict(source) do update set trial_ends_at=excluded.trial_ends_at,review_due=excluded.review_due,failures=0,last_error=null;
 elsif action='export_reports' then
  return coalesce((select jsonb_agg(jsonb_build_object('outing_id',o.id,'starts_at',period.starts_at,'ends_at',period.ends_at,'report',r.data-'notes'-'submission_id'-'coach_ids',
   'forecast',case when rw.report_id is null then w.features when rw.starts_at=period.starts_at and rw.ends_at=period.ends_at then rw.forecast end,
   'source_kind',case when rw.report_id is null then w.source_kind when rw.starts_at=period.starts_at and rw.ends_at=period.ends_at then rw.source_kind end,
   'measurements',case when rw.starts_at=period.starts_at and rw.ends_at=period.ends_at then rw.measurements end))
   from public.reports r join public.outings o on o.id=r.outing_id left join private.weather_features w on w.outing_id=o.id left join private.report_weather rw on rw.report_id=r.id
   cross join lateral (select coalesce(o.actual_starts_at,(r.data->>'actual_start')::timestamptz,o.starts_at) starts_at,coalesce(o.actual_ends_at,(r.data->>'actual_end')::timestamptz,o.ends_at) ends_at) period
   where period.starts_at>=(args->>'start')::timestamptz and period.starts_at<(args->>'end')::timestamptz),'[]');
 else raise exception 'Unknown observation action';end if;
 return coalesce(result,'{}');
end $$;
revoke all on function public.observation_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.observation_query(text,jsonb) to service_role;

-- Existing readiness monitors gain sustained source failures and capacity alerts.
alter function public.monitoring_query(text,jsonb) rename to monitoring_query_before_observations;
create function public.monitoring_query(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.monitoring_query_before_observations(action,args);
 if action='operations' then result:=result||jsonb_build_object('weather_observations',public.observation_query('health',args));end if;
 return result;
end $$;
revoke all on function public.monitoring_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.monitoring_query(text,jsonb) to service_role;

create or replace function private.job_observation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='running' and new.status in ('done','failed','pending') and (new.kind in ('weather','bhc_sync','reminder','enrich') or new.kind like 'observations%') and (new.status<>'pending' or (new.last_error is not null and new.attempts>=old.attempts)) then
  insert into private.operational_events(user_id,operation,outcome) values(new.user_id,new.kind,
   case new.status when 'pending' then 'retry' when 'failed' then 'failed' else 'done' end);
  if new.user_id is not null and new.status in ('pending','failed') then
   perform private.record_activity(new.user_id,case new.status when 'pending' then 'job_retry' else 'job_failed' end,jsonb_build_object('operation',new.kind));
  end if;
 end if;
 return null;
end $$;

-- Training retains forecast inputs; measured outcomes are separate diagnostic evidence.
alter function public.service_query_base(text,jsonb) rename to service_query_before_report_weather;
create function public.service_query_base(action text,args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if action='training_data' then
  return coalesce((select jsonb_agg(jsonb_build_object('outing_id',o.id,'starts_at',coalesce(o.actual_starts_at,(r.data->>'actual_start')::timestamptz,o.starts_at),'user_id',r.user_id,'report',r.data-'notes'-'submission_id','weather',coalesce(rw.forecast,w.features),'source_kind',coalesce(rw.source_kind,w.source_kind),'planned_boat',(select planned_boat from public.outing_members om where om.outing_id=o.id and om.user_id=r.user_id),'coaches',(select coalesce(jsonb_agg(c.name),'[]') from public.coaches c where r.data->'coach_ids' ? c.id::text)))
   from public.reports r join public.outings o on o.id=r.outing_id left join private.report_weather rw on rw.report_id=r.id left join private.weather_features w on w.outing_id=o.id
   where (rw.report_id is null and w.features is not null) or
    (rw.forecast is not null and rw.starts_at=coalesce(o.actual_starts_at,(r.data->>'actual_start')::timestamptz,o.starts_at) and rw.ends_at=coalesce(o.actual_ends_at,(r.data->>'actual_end')::timestamptz,o.ends_at))),'[]');
 elsif action='features_put' and exists(select 1 from private.weather_features where outing_id=(args->>'outing_id')::uuid and run_id is not distinct from (args->>'run_id')::uuid and source_kind=args->>'source_kind' and features=args->'features') then return '{}';
 end if;
 return public.service_query_before_report_weather(action,args);
end $$;
revoke all on function public.service_query_base(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query_base(text,jsonb) to service_role;
create function private.report_forecast_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.forecast is distinct from new.forecast or old.source_kind is distinct from new.source_kind then
  update private.dataset_state set revision=revision+1 where singleton;
  update private.model_runs set status='retired' where status='active';
 end if;return null;
end $$;
create trigger report_forecast_changed after update on private.report_weather for each row execute function private.report_forecast_changed();
revoke all on function private.report_forecast_changed() from public,anon,authenticated;
