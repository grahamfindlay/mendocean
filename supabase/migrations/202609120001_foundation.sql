create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '', role text not null default 'member' check(role in ('member','admin')),
  reminder_channel text not null default 'none' check(reminder_channel in ('none','email','push')),
  reminders_paused boolean not null default false, created_at timestamptz not null default now()
);
create function private.new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id);return new;end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.new_user();
create table public.coaches(id uuid primary key default gen_random_uuid(), name text not null unique, bhc_id bigint unique);
insert into public.coaches(name) values ('Charlie'),('Rose'),('Heather'),('Taylan'),('Alicia'),('Helena'),('Sam'),('Camille'),('Lexi');
create table public.outings (
  id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('official','independent')),
  title text not null check(length(title) between 1 and 120), owner_id uuid references public.profiles on delete set null,
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
  bhc_club_id bigint, bhc_practice_id bigint, planned_boat text, planned_coaches jsonb not null default '[]',
  planned_boats jsonb not null default '[]', version integer not null default 1,
  created_at timestamptz not null default now(), unique(bhc_club_id,bhc_practice_id),
  check ((kind='official')=(bhc_practice_id is not null)),
  check(planned_boat is null or planned_boat in ('1x','2x','2−','2+','4x','4−','4+','8+'))
);
create table public.outing_members (
  outing_id uuid references public.outings on delete cascade, user_id uuid references public.profiles on delete cascade,
  attendance text not null default 'unknown' check(attendance in ('attending','declined','unknown')),
  reminder boolean not null default false, skipped boolean not null default false,
  planned_boat text, planned_seat text, deadline timestamptz, synced_at timestamptz,
  primary key(outing_id,user_id)
);
create table public.reports (
  id uuid primary key default gen_random_uuid(), outing_id uuid not null references public.outings on delete cascade,
  user_id uuid not null references public.profiles on delete cascade, version integer not null default 1,
  data jsonb not null, outcome text generated always as(data->>'outcome') stored,
  rating integer generated always as((data->>'rating')::integer) stored,
  forced_off boolean generated always as(coalesce((data->>'rating')::integer=5,false)) stored,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(outing_id,user_id), check(outcome in ('rowed','stayed_ashore','did_not_attend')),
  check((outcome='rowed' and rating between 1 and 5) or (outcome<>'rowed' and rating is null))
);
create table private.submissions(user_id uuid references public.profiles on delete cascade, submission_id uuid, response jsonb not null, primary key(user_id,submission_id));
create table private.outing_links(token_hash text primary key, outing_id uuid references public.outings on delete cascade, expires_at timestamptz not null);
create table private.bhc_connections(user_id uuid primary key references public.profiles on delete cascade, ciphertext text not null, iv text not null, custid bigint not null, club_id bigint not null, last_sync timestamptz, last_error text, revoked_at timestamptz);
create table private.push_subscriptions(user_id uuid references public.profiles on delete cascade, endpoint text unique not null, subscription jsonb not null, primary key(user_id,endpoint));
create table private.jobs (
  id bigint generated always as identity primary key, kind text not null, user_id uuid references public.profiles on delete cascade,
  outing_id uuid references public.outings on delete cascade, due_at timestamptz not null,
  expires_at timestamptz not null, dedupe_key text not null unique, payload jsonb not null default '{}',
  status text not null default 'pending' check(status in ('pending','running','done','failed','cancelled')),
  attempts integer not null default 0, locked_at timestamptz, last_error text
);
create index jobs_due on private.jobs(due_at) where status='pending';
create table public.weather_runs(id uuid primary key default gen_random_uuid(),fetched_at timestamptz not null, provider text not null, object_path text not null unique, summary jsonb not null);
create index weather_recent on public.weather_runs(fetched_at desc);
create table private.weather_features(outing_id uuid primary key references public.outings on delete cascade, run_id uuid references public.weather_runs, source_kind text not null, features jsonb not null, updated_at timestamptz not null default now());
create table private.model_runs(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),family text not null, artifact jsonb not null, metrics jsonb not null, status text not null default 'shadow' check(status in ('shadow','approved','active','retired')));
create unique index one_active_model on private.model_runs((status)) where status='active';
create table private.audit(id bigint generated always as identity primary key,at timestamptz not null default now(),actor uuid,event text not null,details jsonb not null default '{}');

alter table public.profiles enable row level security;
alter table public.coaches enable row level security;
alter table public.outings enable row level security;
alter table public.outing_members enable row level security;
alter table public.reports enable row level security;
alter table public.weather_runs enable row level security;
create function public.is_outing_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.outing_members where outing_id=target and user_id=auth.uid())$$;
revoke all on function public.is_outing_member(uuid) from public;
grant execute on function public.is_outing_member(uuid) to authenticated;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy coach_names on public.coaches for select to authenticated using(true);
create policy joined_outings on public.outings for select to authenticated using(public.is_outing_member(id));
create policy own_membership on public.outing_members for select to authenticated using(user_id=auth.uid());
create policy own_reports on public.reports for select to authenticated using(user_id=auth.uid());
revoke all on all tables in schema public from anon, authenticated;
grant select on public.profiles,public.coaches,public.outings,public.outing_members,public.reports to authenticated;

-- Every report write is atomic and retryable. API validation is repeated for critical DB invariants.
create function public.save_report(target uuid, body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); prior public.reports; result jsonb; sid uuid:=(body->>'submission_id')::uuid; cid text;
begin
  if uid is null or not public.is_outing_member(target) then raise exception 'Outing access denied';end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  select response into result from private.submissions where user_id=uid and submission_id=sid;
  if found then return result;end if;
  if body->>'outcome' not in ('rowed','stayed_ashore','did_not_attend') or body->>'scope' not in ('personal','whole_outing') or body->>'route' not in ('east','west','both','unknown') then raise exception 'Invalid report';end if;
  if body->>'outcome'='stayed_ashore' and coalesce(body->>'reason','') not in ('wind_waves','other_weather','non_weather','unknown') then raise exception 'Reason required';end if;
  if body->>'outcome'<>'rowed' and (jsonb_array_length(body->'segments')>0 or jsonb_array_length(body->'launched_boats')>0) then raise exception 'No observed water without rowing';end if;
  if length(body->>'notes')>2000 or jsonb_array_length(body->'coach_ids')>30 then raise exception 'Report too large';end if;
  for cid in select jsonb_array_elements_text(body->'coach_ids') loop
    if not exists(select 1 from public.coaches where id=cid::uuid) then raise exception 'Unknown coach';end if;
  end loop;
  select * into prior from public.reports where outing_id=target and user_id=uid for update;
  if coalesce(prior.version,0)<>(body->>'expected_version')::integer then raise exception 'This report changed elsewhere. Reload before editing.' using errcode='40001';end if;
  insert into public.reports(outing_id,user_id,data) values(target,uid,body)
  on conflict(outing_id,user_id) do update set data=excluded.data,version=public.reports.version+1,updated_at=now()
  returning jsonb_build_object('id',id,'version',version,'outing_id',outing_id) into result;
  insert into private.submissions values(uid,sid,result);
  update private.jobs set status='cancelled' where user_id=uid and outing_id=target and kind='reminder' and status='pending';
  -- Models depending on changed data must be retrained before republishing.
  if prior.id is not null then update private.model_runs set status='retired' where status='active';end if;
  return result;
end $$;
revoke all on function public.save_report(uuid,jsonb) from public;
grant execute on function public.save_report(uuid,jsonb) to authenticated;

create function public.delete_report(target uuid,expected integer) returns void language plpgsql security definer set search_path='' as $$
begin
  delete from public.reports where id=target and user_id=auth.uid() and version=expected;
  if not found then raise exception 'Report unavailable or changed. Reload before deleting.';end if;
  delete from private.submissions where user_id=auth.uid() and response->>'id'=target::text;
  update private.model_runs set status='retired' where status='active';
end $$;
revoke all on function public.delete_report(uuid,integer) from public;
grant execute on function public.delete_report(uuid,integer) to authenticated;

-- Private tables are reachable only from service-role functions, never the browser API.
create function public.service_query(action text,args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if action='connection_get' then select to_jsonb(c) into result from private.bhc_connections c where user_id=(args->>'user_id')::uuid and revoked_at is null;
  elsif action='connection_put' then
    insert into private.bhc_connections(user_id,ciphertext,iv,custid,club_id) values((args->>'user_id')::uuid,args->>'ciphertext',args->>'iv',(args->>'custid')::bigint,(args->>'club_id')::bigint)
    on conflict(user_id) do update set ciphertext=excluded.ciphertext,iv=excluded.iv,custid=excluded.custid,club_id=excluded.club_id,revoked_at=null;
  elsif action='connection_delete' then delete from private.bhc_connections where user_id=(args->>'user_id')::uuid;update private.jobs set status='cancelled' where user_id=(args->>'user_id')::uuid and kind='bhc_sync' and status='pending';
  elsif action='connection_synced' then update private.bhc_connections set last_sync=now(),last_error=args->>'error' where user_id=(args->>'user_id')::uuid;
  elsif action='connections' then select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'last_sync',last_sync)),'[]') into result from private.bhc_connections where revoked_at is null;
  elsif action='enqueue' then
    insert into private.jobs(kind,user_id,outing_id,due_at,expires_at,dedupe_key,payload) values(args->>'kind',(args->>'user_id')::uuid,(args->>'outing_id')::uuid,(args->>'due_at')::timestamptz,(args->>'expires_at')::timestamptz,args->>'dedupe_key',coalesce(args->'payload','{}'))
    on conflict(dedupe_key) do update set due_at=excluded.due_at,expires_at=excluded.expires_at where private.jobs.status='pending';
  elsif action='claim' then
    update private.jobs set status='pending' where status='running' and locked_at<now()-interval '10 minutes';
    update private.jobs set status='cancelled' where status='pending' and expires_at<now();
    with selected as(select id from private.jobs where status='pending' and due_at<=now() order by due_at limit 10 for update skip locked), claimed as(update private.jobs j set status='running',locked_at=now(),attempts=attempts+1 from selected where j.id=selected.id returning j.*) select coalesce(jsonb_agg(to_jsonb(claimed)),'[]') into result from claimed;
  elsif action='job_finish' then update private.jobs set status=args->>'status',last_error=args->>'error',due_at=coalesce((args->>'due_at')::timestamptz,due_at) where id=(args->>'id')::bigint;
  elsif action='push_put' then insert into private.push_subscriptions values((args->>'user_id')::uuid,args->'subscription'->>'endpoint',args->'subscription') on conflict(endpoint) do update set user_id=excluded.user_id,subscription=excluded.subscription;
  elsif action='push_get' then select coalesce(jsonb_agg(subscription),'[]') into result from private.push_subscriptions where user_id=(args->>'user_id')::uuid;
  elsif action='push_delete' then delete from private.push_subscriptions where endpoint=args->>'endpoint';
  elsif action='link_put' then insert into private.outing_links values(args->>'hash',(args->>'outing_id')::uuid,now()+interval '7 days');
  elsif action='link_get' then select to_jsonb(l) into result from private.outing_links l where token_hash=args->>'hash' and expires_at>now();
  elsif action='features_put' then insert into private.weather_features(outing_id,run_id,source_kind,features) values((args->>'outing_id')::uuid,(args->>'run_id')::uuid,args->>'source_kind',args->'features') on conflict(outing_id) do update set run_id=excluded.run_id,source_kind=excluded.source_kind,features=excluded.features,updated_at=now();
  elsif action='training_data' then select coalesce(jsonb_agg(jsonb_build_object('outing_id',o.id,'starts_at',coalesce(o.actual_starts_at,o.starts_at),'user_id',r.user_id,'report',r.data-'notes'-'submission_id','weather',w.features,'source_kind',w.source_kind,'planned_boat',(select planned_boat from public.outing_members om where om.outing_id=o.id and om.user_id=r.user_id),'coaches',(select coalesce(jsonb_agg(c.name),'[]') from public.coaches c where r.data->'coach_ids' ? c.id::text))),'[]') into result from public.reports r join public.outings o on o.id=r.outing_id join private.weather_features w on w.outing_id=o.id;
  elsif action='model_shadow' then insert into private.model_runs(family,artifact,metrics) values(args->>'family',args->'artifact',args->'metrics') returning to_jsonb(private.model_runs.*) into result;
  elsif action='model_list' then select coalesce(jsonb_agg(to_jsonb(m) order by created_at desc),'[]') into result from private.model_runs m;
  elsif action='audit' then insert into private.audit(actor,event,details) values((args->>'actor')::uuid,args->>'event',coalesce(args->'details','{}'));
  else raise exception 'Unknown service action';end if;
  return coalesce(result,'{}');
end $$;
revoke all on function public.service_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query(text,jsonb) to service_role;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
