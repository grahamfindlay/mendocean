-- Attendee snapshots are isolated per connected account. Teammates need no Mendocean account.
alter table private.bhc_connections add column lineup_error text, add column lineup_checked_at timestamptz;
alter table public.profiles add column lineup_channels text[] not null default '{}'
 check(lineup_channels <@ array['email','push']::text[] and cardinality(lineup_channels)<=2 and array_position(lineup_channels,null) is null),
 add column lineup_changes text not null default 'crew' check(lineup_changes in ('crew','assignment'));
create table private.lineup_snapshots (
 user_id uuid references public.profiles on delete cascade, outing_id uuid references public.outings on delete cascade,
 connection_revision bigint not null, version integer not null default 1, snapshot jsonb not null,
 assignment_signature text not null, crew_signature text not null, checked_at timestamptz not null default now(),
 primary key(user_id,outing_id)
);
create table private.lineup_events (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles on delete cascade,
 outing_id uuid references public.outings on delete cascade, connection_revision bigint not null,
 version integer not null, kind text not null check(kind in ('published','assignment','crew')),
 summary text not null, snapshot jsonb not null, created_at timestamptz not null default now(),
 unique(user_id,outing_id,connection_revision,version)
);
create table private.lineup_deliveries (
 event_id uuid references private.lineup_events on delete cascade, channel text check(channel in ('email','push')),
 payload jsonb, reserved_at timestamptz, sent_at timestamptz, lease_token uuid, locked_until timestamptz,
 error text, primary key(event_id,channel)
);
create table private.lineup_devices (
 event_id uuid, channel text not null default 'push' check(channel='push'), endpoint text,
 sent_at timestamptz not null default now(), primary key(event_id,endpoint),
 foreign key(event_id,channel) references private.lineup_deliveries on delete cascade
);
alter table private.lineup_snapshots enable row level security;
alter table private.lineup_events enable row level security;
alter table private.lineup_deliveries enable row level security;
alter table private.lineup_devices enable row level security;

create function public.lineup_save(uid uuid,revision bigint,outing uuid,snapshot jsonb,assignment text,crew text,summary text,notify boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare c private.bhc_connections; old private.lineup_snapshots; v integer; relevant boolean; event uuid; channel text; event_kind text;
begin
 select * into c from private.bhc_connections where user_id=uid for update;
 if not found or c.revision<>revision or c.revoked_at is not null or c.access_state<>'active'
 or c.expires_at<=now() or c.sync_locked_until is null or c.sync_locked_until<=now() then return false;end if;
 if not exists(select 1 from public.outings o join private.bhc_settings s on s.club_id=o.bhc_club_id where o.id=outing and o.bhc_club_id=c.club_id) then return false;end if;
 if not exists(select 1 from public.outing_members m where m.user_id=uid and m.outing_id=outing and m.attendance='attending' and m.bhc_revision=c.revision) then
  delete from private.lineup_snapshots where user_id=uid and outing_id=outing;return false;
 end if;
 select * into old from private.lineup_snapshots where user_id=uid and outing_id=outing for update;
 relevant:=old.user_id is null or old.snapshot->>'published' is distinct from snapshot->>'published' or old.crew_signature<>crew or old.connection_revision<>revision;
 v:=coalesce(old.version,0)+case when relevant then 1 else 0 end;
 insert into private.lineup_snapshots(user_id,outing_id,connection_revision,version,snapshot,assignment_signature,crew_signature)
 values(uid,outing,revision,v,snapshot,assignment,crew)
 on conflict(user_id,outing_id) do update set connection_revision=excluded.connection_revision,version=excluded.version,
 snapshot=excluded.snapshot,assignment_signature=excluded.assignment_signature,crew_signature=excluded.crew_signature,checked_at=now();
 if relevant then update private.jobs set status='cancelled' where user_id=uid and outing_id=outing and kind='lineup_notify' and status='pending';end if;
 if not notify or not relevant or snapshot->>'published'<>'true' or (old.user_id is not null and old.connection_revision<>revision)
 or not exists(select 1 from public.outings where id=outing and starts_at+interval '30 minutes'>now()) then return true;end if;
 event_kind:=case when coalesce(old.snapshot->>'published','false')<>'true' then 'published' when old.assignment_signature<>assignment then 'assignment' else 'crew' end;
 insert into private.lineup_events(user_id,outing_id,connection_revision,version,kind,summary,snapshot)
 values(uid,outing,revision,v,event_kind,summary,snapshot) returning id into event;
 for channel in select unnest(p.lineup_channels) from public.profiles p where p.id=uid and p.approved and (event_kind<>'crew' or p.lineup_changes='crew') loop
  insert into private.lineup_deliveries(event_id,channel) values(event,channel);
  insert into private.jobs(kind,user_id,outing_id,due_at,expires_at,dedupe_key,payload)
  select 'lineup_notify',uid,outing,now(),starts_at+interval '30 minutes','lineup:'||event||':'||channel,jsonb_build_object('event_id',event,'channel',channel) from public.outings where id=outing;
 end loop;
 return true;
end $$;

-- Existing outing membership is broader than lineup visibility. Enforce attending + current BHC identity here.
create function public.lineups_get(uid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(l.snapshot || jsonb_build_object('outing_id',l.outing_id,'checked_at',l.checked_at,'version',l.version) order by o.starts_at),'[]')
 from private.lineup_snapshots l join public.outings o on o.id=l.outing_id
 join public.outing_members m on m.outing_id=o.id and m.user_id=l.user_id
 join private.bhc_connections c on c.user_id=l.user_id
 join public.profiles p on p.id=l.user_id join private.bhc_settings s on s.club_id=c.club_id
 where l.user_id=uid and p.approved and c.revoked_at is null and c.access_state<>'membership_missing'
 and l.connection_revision=c.revision and m.bhc_revision=c.revision and m.attendance='attending'
 and o.ends_at>now() and l.snapshot->>'published'='true'
$$;
create function public.lineup_previous(uid uuid,outing uuid,revision bigint) returns jsonb language sql stable security definer set search_path='' as $$
 select snapshot from private.lineup_snapshots where user_id=uid and outing_id=outing and connection_revision=revision
$$;
create function public.lineup_poll_candidates() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]') from (select distinct c.user_id,c.revision from private.bhc_connections c
 join public.profiles p on p.id=c.user_id join public.outing_members m on m.user_id=c.user_id
 join public.outings o on o.id=m.outing_id join private.bhc_settings s on s.club_id=o.bhc_club_id
 left join private.lineup_snapshots l on l.user_id=c.user_id and l.outing_id=o.id
 where p.approved and c.revoked_at is null and c.access_state='active' and (c.expires_at is null or c.expires_at>now())
 and c.club_id=o.bhc_club_id and m.bhc_revision=c.revision and m.attendance='attending'
 and coalesce(m.deadline,o.starts_at-interval '24 hours')<=now() and o.starts_at+interval '30 minutes'>now()
 and (l.checked_at is null or l.checked_at<=now()-interval '4 minutes')) x
$$;
create function private.lineup_delivery_allowed(event uuid,target_channel text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.lineup_events e join private.lineup_snapshots l on l.user_id=e.user_id and l.outing_id=e.outing_id
 join private.bhc_connections c on c.user_id=e.user_id join private.bhc_settings s on s.club_id=c.club_id
 join public.outing_members m on m.user_id=e.user_id and m.outing_id=e.outing_id
 join public.outings o on o.id=e.outing_id join public.profiles p on p.id=e.user_id
 where e.id=event and p.approved and target_channel=any(p.lineup_channels) and (e.kind<>'crew' or p.lineup_changes='crew')
 and c.revoked_at is null and c.access_state='active' and (c.expires_at is null or c.expires_at>now())
 and c.revision=e.connection_revision and l.connection_revision=c.revision and m.bhc_revision=c.revision and c.club_id=o.bhc_club_id
 and m.attendance='attending' and l.version=e.version and l.snapshot->>'published'='true'
 and now()<o.starts_at+interval '30 minutes')
$$;
create function public.lineup_reserve(event uuid,target_channel text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.lineup_deliveries; e private.lineup_events; used integer; token uuid:=gen_random_uuid();
begin
 perform pg_advisory_xact_lock(846302);
 if not private.lineup_delivery_allowed(event,target_channel) then return '{"allowed":false}';end if;
 select * into d from private.lineup_deliveries where event_id=event and channel=target_channel for update;
 if not found or d.sent_at is not null then return '{"allowed":false}';end if;
 -- Temporary lack of freshness delays delivery; it must not consume the event permanently.
 if exists(select 1 from private.lineup_events fresh_event join private.lineup_snapshots l on l.user_id=fresh_event.user_id and l.outing_id=fresh_event.outing_id where fresh_event.id=event and l.checked_at<=now()-interval '15 minutes') then return '{"allowed":false,"retry":true}';end if;
 if d.locked_until>now() then return '{"allowed":false,"retry":true}';end if;
 if d.reserved_at<now()-interval '24 hours' then return '{"allowed":false}';end if;
 if target_channel='email' and d.reserved_at is null then
  select (select count(*) from private.delivery_budget where channel='email' and reserved_at>=date_trunc('day',now()))+
   (select count(*) from private.lineup_deliveries where channel='email' and reserved_at>=date_trunc('day',now())) into used;
  if used>=80 then return '{"allowed":false,"retry":true}';end if;
 end if;
 update private.lineup_deliveries set reserved_at=coalesce(reserved_at,now()),lease_token=token,locked_until=now()+interval '5 minutes' where event_id=event and channel=target_channel;
 select * into e from private.lineup_events where id=event;
 return jsonb_build_object('allowed',true,'token',token,'key','lineup/'||event||'/'||target_channel,'event',to_jsonb(e),'payload',d.payload,
 'devices',(select coalesce(jsonb_agg(endpoint),'[]') from private.lineup_devices where event_id=event));
end $$;
create function public.lineup_delivery_active(event uuid,target_channel text,token uuid,target_endpoint text default null) returns boolean language sql stable security definer set search_path='' as $$
 select private.lineup_delivery_allowed(event,target_channel) and exists(select 1 from private.lineup_deliveries where event_id=event and channel=target_channel and lease_token=token and locked_until>now() and sent_at is null)
 and exists(select 1 from private.lineup_events e join private.lineup_snapshots l on l.user_id=e.user_id and l.outing_id=e.outing_id where e.id=event and l.checked_at>now()-interval '15 minutes')
 and (target_endpoint is null or exists(select 1 from private.push_subscriptions p join private.lineup_events e on e.user_id=p.user_id where e.id=event and p.endpoint=target_endpoint))
$$;
create function public.lineup_prepare_email(event uuid,token uuid,message jsonb) returns jsonb language sql security definer set search_path='' as $$
 update private.lineup_deliveries set payload=coalesce(payload,message) where event_id=event and channel='email' and lease_token=token
 and public.lineup_delivery_active(event,'email',token) returning payload
$$;
create function public.lineup_finish_device(event uuid,token uuid,target_endpoint text) returns void language sql security definer set search_path='' as $$
 insert into private.lineup_devices(event_id,endpoint) select event,target_endpoint
 where exists(select 1 from private.lineup_deliveries where event_id=event and channel='push' and lease_token=token)
 on conflict do nothing
$$;
create function public.lineup_finish(event uuid,target_channel text,token uuid,failure text default null) returns void language sql security definer set search_path='' as $$
 update private.lineup_deliveries set sent_at=case when failure is null then now() else sent_at end,error=failure,lease_token=null,locked_until=null
 where event_id=event and channel=target_channel and lease_token=token
$$;

-- Preserve reminder leases and idempotency; share its reserved email allowance with lineup delivery.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.reserve_reminder_channel(uuid,uuid,integer,text)'::regprocedure);
 if position('select count(*) into used from private.delivery_budget b' in definition)=0 then raise exception 'Reminder budget contract changed';end if;
 definition:=replace(definition,'select count(*) into used from private.delivery_budget b where b.channel=''email'' and b.reserved_at>=date_trunc(''day'',now());',
 'select (select count(*) from private.delivery_budget b where b.channel=''email'' and b.reserved_at>=date_trunc(''day'',now())) + (select count(*) from private.lineup_deliveries where channel=''email'' and reserved_at>=date_trunc(''day'',now())) into used;');
 execute definition;
end $$;
-- No browser access to snapshots, crew identities, queues or service RPCs.
revoke all on function public.lineup_save(uuid,bigint,uuid,jsonb,text,text,text,boolean),public.lineups_get(uuid),public.lineup_previous(uuid,uuid,bigint),public.lineup_poll_candidates(),private.lineup_delivery_allowed(uuid,text),public.lineup_reserve(uuid,text),public.lineup_delivery_active(uuid,text,uuid,text),public.lineup_prepare_email(uuid,uuid,jsonb),public.lineup_finish_device(uuid,uuid,text),public.lineup_finish(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.lineup_save(uuid,bigint,uuid,jsonb,text,text,text,boolean),public.lineups_get(uuid),public.lineup_previous(uuid,uuid,bigint),public.lineup_poll_candidates(),public.lineup_reserve(uuid,text),public.lineup_delivery_active(uuid,text,uuid,text),public.lineup_prepare_email(uuid,uuid,jsonb),public.lineup_finish_device(uuid,uuid,text),public.lineup_finish(uuid,text,uuid,text) to service_role;

-- Lineup polling has independent freshness/error state; it must not mark a full import complete.
alter function public.service_query(text,jsonb) rename to service_query_before_lineups;
create function public.service_query(action text,args jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if action in ('lineup_checked','lineup_problem') then
  update private.bhc_connections set lineup_error=case when action='lineup_problem' then 'Lineup updates could not be checked. Try again later.' else null end,
   lineup_checked_at=case when action='lineup_checked' then now() else lineup_checked_at end
   where user_id=(args->>'user_id')::uuid and revision=(args->>'revision')::bigint and revoked_at is null;
  return '{}';
 end if;
 result:=public.service_query_before_lineups(action,args);
 if action='connection_delete' then
  update private.jobs set status='cancelled' where user_id=(args->>'user_id')::uuid and kind in ('lineup_poll','lineup_notify') and status='pending';
 elsif action='claim' then
  -- Short-lived personal snapshots; reports and practice history remain independent.
  delete from private.lineup_events where created_at<now()-interval '7 days';
  delete from private.lineup_snapshots l using public.outings o where l.outing_id=o.id and o.ends_at<now()-interval '2 days';
 end if;
 return result;
end $$;
revoke all on function public.service_query(text,jsonb) from public,anon,authenticated;
grant execute on function public.service_query(text,jsonb) to service_role;
