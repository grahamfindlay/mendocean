-- Additive preferences; preserve the legacy field for cached clients during rollout.
alter table public.profiles add column reminder_channels text[] not null default '{}'
  check(reminder_channels <@ array['email','push']::text[] and cardinality(reminder_channels)<=2 and array_position(reminder_channels,null) is null);
update public.profiles set reminder_channels=case when reminder_channel='none' then '{}'::text[] else array[reminder_channel] end;
create function private.sync_reminder_channels() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
   if cardinality(new.reminder_channels)=0 and new.reminder_channel<>'none' then new.reminder_channels=array[new.reminder_channel];end if;
 elsif new.reminder_channels is not distinct from old.reminder_channels and new.reminder_channel is distinct from old.reminder_channel then
   new.reminder_channels=case when new.reminder_channel='none' then '{}'::text[] else array[new.reminder_channel] end;
 end if;
 new.reminder_channels=array(select distinct c from unnest(new.reminder_channels) c order by c);
 new.reminder_channel=coalesce(new.reminder_channels[1],'none');
 return new;
end $$;
create trigger sync_reminder_channels before insert or update on public.profiles for each row execute function private.sync_reminder_channels();

-- The existing delivery row owns the reminder generation; children own channel outcomes.
create table private.reminder_channels (
 user_id uuid references public.profiles on delete cascade,
 outing_id uuid references public.outings on delete cascade,
 generation integer not null, channel text not null check(channel in ('email','push')),
 provider_key text not null, payload jsonb, sent_at timestamptz, lease_token uuid, locked_until timestamptz,
 attempts integer not null default 0, last_error text,
 primary key(user_id,outing_id,generation,channel)
);
alter table private.reminder_channels enable row level security;
create table private.reminder_devices (
 user_id uuid, outing_id uuid, generation integer, channel text not null default 'push' check(channel='push'),
 endpoint text not null, sent_at timestamptz, expired boolean not null default false,
 primary key(user_id,outing_id,generation,endpoint),
 foreign key(user_id,outing_id,generation,channel) references private.reminder_channels on delete cascade
);
alter table private.reminder_devices enable row level security;
-- Preserve previously accepted sends and the provider key of ambiguous in-flight email retries.
insert into private.reminder_channels(user_id,outing_id,generation,channel,provider_key,sent_at)
 select user_id,outing_id,generation,channel,'reminder/'||user_id||'/'||outing_id||'/'||generation,sent_at
 from private.deliveries where channel in ('email','push');
alter table private.delivery_budget drop constraint delivery_budget_pkey;
alter table private.delivery_budget add primary key(user_id,outing_id,generation,channel);

create function private.reminder_allowed(uid uuid,outing uuid,gen integer,target_channel text) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.profiles p join public.outing_members m on m.user_id=p.id
 join public.outings o on o.id=m.outing_id join private.deliveries d on d.user_id=m.user_id and d.outing_id=m.outing_id
 where p.id=uid and o.id=outing and p.approved and not p.reminders_paused and target_channel=any(p.reminder_channels)
 and m.attendance='attending' and m.reminder and not m.skipped and d.generation=gen and d.sent_at is null
 and now()>=o.ends_at+interval '15 minutes' and now()<=o.ends_at+interval '24 hours'
 and not exists(select 1 from public.reports r where r.user_id=uid and r.outing_id=outing))
$$;
create function private.complete_reminder(uid uuid,outing uuid,gen integer) returns void language sql set search_path='' as $$
 update private.deliveries d set sent_at=now() from public.profiles p
 where d.user_id=uid and d.outing_id=outing and d.generation=gen and d.sent_at is null and p.id=uid
 and cardinality(p.reminder_channels)>0 and not exists(
  select 1 from unnest(p.reminder_channels) c where not exists(select 1 from private.reminder_channels s
  where s.user_id=uid and s.outing_id=outing and s.generation=gen and s.channel=c and s.sent_at is not null))
$$;
create function public.reserve_reminder_channel(uid uuid,outing uuid,gen integer,target_channel text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d private.deliveries; c private.reminder_channels; token uuid:=gen_random_uuid(); used integer;
begin
 perform pg_advisory_xact_lock(846302);
 if target_channel not in ('email','push') then raise exception 'Invalid channel';end if;
 select * into d from private.deliveries where user_id=uid and outing_id=outing for update;
 if not found then
  if gen<>0 then return '{"allowed":false}';end if;
  insert into private.deliveries(user_id,outing_id,channel) values(uid,outing,target_channel);
 end if;
 if not private.reminder_allowed(uid,outing,gen,target_channel) then return '{"allowed":false}';end if;
 insert into private.reminder_channels(user_id,outing_id,generation,channel,provider_key)
 values(uid,outing,gen,target_channel,'reminder/'||uid||'/'||outing||'/'||gen||case when exists(select 1 from private.delivery_budget b where b.user_id=uid and b.outing_id=outing and b.generation=gen and b.channel=target_channel) then '' else '/'||target_channel end) on conflict do nothing;
 select * into c from private.reminder_channels where user_id=uid and outing_id=outing and generation=gen and channel=target_channel for update;
 if c.sent_at is not null then perform private.complete_reminder(uid,outing,gen);return '{"allowed":false}';end if;
 if target_channel='email' and exists(select 1 from private.delivery_budget b where b.user_id=uid and b.outing_id=outing and b.generation=gen and b.channel='email' and b.reserved_at<=now()-interval '24 hours') then
  update private.reminder_channels set last_error='retry_expired' where user_id=uid and outing_id=outing and generation=gen and channel=target_channel;
  return '{"allowed":false}';
 end if;
 if c.locked_until>now() then return '{"allowed":false,"busy":true}';end if;
 if not exists(select 1 from private.delivery_budget b where b.user_id=uid and b.outing_id=outing and b.generation=gen and b.channel=target_channel) then
  if target_channel='email' then
   select count(*) into used from private.delivery_budget b where b.channel='email' and b.reserved_at>=date_trunc('day',now());
   if used>=80 then
    update private.reminder_channels set last_error='quota' where user_id=uid and outing_id=outing and generation=gen and channel=target_channel;
    return '{"allowed":false,"quota":true}';
   end if;
  end if;
  insert into private.delivery_budget(user_id,outing_id,generation,channel) values(uid,outing,gen,target_channel);
 end if;
 update private.reminder_channels set lease_token=token,locked_until=now()+interval '5 minutes',attempts=attempts+1
 where user_id=uid and outing_id=outing and generation=gen and channel=target_channel;
 return jsonb_build_object('allowed',true,'token',token,'key',c.provider_key,'devices',
  (select coalesce(jsonb_agg(jsonb_build_object('endpoint',endpoint,'sent',sent_at is not null,'expired',expired)),'[]')
   from private.reminder_devices where user_id=uid and outing_id=outing and generation=gen));
end $$;
create function public.reminder_channel_active(uid uuid,outing uuid,gen integer,target_channel text,token uuid,target_endpoint text default null) returns boolean
language sql stable security definer set search_path='' as $$
 select private.reminder_allowed(uid,outing,gen,target_channel) and exists(select 1 from private.reminder_channels
 where user_id=uid and outing_id=outing and generation=gen and channel=target_channel and lease_token=token and locked_until>now() and sent_at is null)
 and (target_endpoint is null or exists(select 1 from private.push_subscriptions where user_id=uid and endpoint=target_endpoint))
$$;
-- Pin recipient/content as well as the key, so practice edits cannot change a retry payload.
create function public.prepare_reminder_email(uid uuid,outing uuid,gen integer,token uuid,message jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 update private.reminder_channels set payload=coalesce(payload,message)
 where user_id=uid and outing_id=outing and generation=gen and channel='email' and lease_token=token
 and public.reminder_channel_active(uid,outing,gen,'email',token)
 returning payload into result;
 return result;
end $$;
create function public.finish_reminder_device(uid uuid,outing uuid,gen integer,token uuid,target_endpoint text,gone boolean) returns void
language sql security definer set search_path='' as $$
 insert into private.reminder_devices(user_id,outing_id,generation,endpoint,sent_at,expired)
 select uid,outing,gen,target_endpoint,case when gone then null else now() end,gone
 where exists(select 1 from private.reminder_channels where user_id=uid and outing_id=outing and generation=gen and channel='push' and lease_token=token)
 on conflict(user_id,outing_id,generation,endpoint) do update set sent_at=excluded.sent_at,expired=excluded.expired
$$;
create function public.finish_reminder_channel(uid uuid,outing uuid,gen integer,target_channel text,token uuid,failure text default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(846302);
 update private.reminder_channels set sent_at=case when failure is null then now() else sent_at end,
 last_error=failure,locked_until=null,lease_token=null
 where user_id=uid and outing_id=outing and generation=gen and channel=target_channel and lease_token=token;
 perform private.complete_reminder(uid,outing,gen);
end $$;
-- An old worker finishing during deployment records the same outcome for the new worker.
create or replace function public.finish_delivery(uid uuid,outing uuid,gen integer) returns void language plpgsql security definer set search_path='' as $$
declare d private.deliveries;
begin
 perform pg_advisory_xact_lock(846302);
 update private.deliveries set sent_at=now() where user_id=uid and outing_id=outing and generation=gen returning * into d;
 if found and d.channel in ('email','push') then
  insert into private.reminder_channels(user_id,outing_id,generation,channel,provider_key,sent_at)
  values(uid,outing,gen,d.channel,'reminder/'||uid||'/'||outing||'/'||gen,now())
  on conflict(user_id,outing_id,generation,channel) do update set sent_at=now();
 end if;
end $$;
create or replace function public.reset_reminder(uid uuid,outing uuid,repeat boolean) returns integer language plpgsql security definer set search_path='' as $$
declare gen integer:=0; channel text;
begin
 perform pg_advisory_xact_lock(846302);
 update private.jobs set status='cancelled' where user_id=uid and outing_id=outing and kind='reminder' and status='pending';
 if repeat then
  select reminder_channel into channel from public.profiles where id=uid;
  insert into private.deliveries(user_id,outing_id,channel,generation) values(uid,outing,channel,1)
  on conflict(user_id,outing_id) do update set sent_at=null,reserved_at=now(),generation=private.deliveries.generation+1,channel=excluded.channel returning generation into gen;
 else select generation into gen from private.deliveries where user_id=uid and outing_id=outing;
 end if;
 return coalesce(gen,0);
end $$;
-- Re-enable eligible, unfinished reminders after changing account preferences/device setup.
-- Completed generations are never reopened by a settings change; explicit snooze does that.
create function public.refresh_reminder_jobs(uid uuid) returns void language plpgsql security definer set search_path='' as $$
declare r record;
begin
 perform pg_advisory_xact_lock(846302);
 for r in select m.outing_id,coalesce(d.generation,0) gen,o.ends_at from public.outing_members m
 join public.outings o on o.id=m.outing_id join public.profiles p on p.id=m.user_id
 left join private.deliveries d on d.user_id=m.user_id and d.outing_id=m.outing_id
 where m.user_id=uid and m.reminder and not m.skipped and m.attendance='attending'
 and not p.reminders_paused and cardinality(p.reminder_channels)>0 and d.sent_at is null and o.ends_at+interval '24 hours'>now()
 and not exists(select 1 from public.reports where user_id=uid and outing_id=m.outing_id)
 loop
  perform private.complete_reminder(uid,r.outing_id,r.gen);
  if exists(select 1 from private.deliveries where user_id=uid and outing_id=r.outing_id and sent_at is not null) then continue;end if;
  if not exists(select 1 from private.jobs where user_id=uid and outing_id=r.outing_id and kind='reminder' and status='pending' and coalesce((payload->>'generation')::integer,0)=r.gen) then
   insert into private.jobs(kind,user_id,outing_id,due_at,expires_at,dedupe_key,payload)
   values('reminder',uid,r.outing_id,greatest(now(),r.ends_at+interval '15 minutes'),r.ends_at+interval '24 hours',
    'preferences:'||gen_random_uuid(),jsonb_build_object('generation',r.gen));
  end if;
 end loop;
end $$;
create or replace function public.reminder_states(uid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('outing_id',m.outing_id,'sent_at',d.sent_at,
 'due_at',case when d.sent_at is null then j.due_at else null end,
 'channels',(select coalesce(jsonb_agg(jsonb_build_object('channel',c,'sent_at',s.sent_at,'error',s.last_error,
 'status',case when s.sent_at is not null then 'sent' when d.sent_at is not null then 'not_requested' when s.last_error is not null then case when j.due_at is null then 'failed' else 'retrying' end else 'pending' end,
 'devices_sent',(select count(*) from private.reminder_devices v where v.user_id=uid and v.outing_id=m.outing_id and v.generation=coalesce(d.generation,0) and v.sent_at is not null and c='push'))), '[]')
 from unnest(p.reminder_channels) c left join private.reminder_channels s on s.user_id=uid and s.outing_id=m.outing_id and s.generation=coalesce(d.generation,0) and s.channel=c)
 )), '[]')
 from public.outing_members m join public.profiles p on p.id=m.user_id
 left join private.deliveries d on d.user_id=m.user_id and d.outing_id=m.outing_id
 left join lateral(select min(due_at) due_at from private.jobs where user_id=uid and outing_id=m.outing_id and kind='reminder'
 and status in ('pending','running') and expires_at>now() and coalesce((payload->>'generation')::integer,0)=coalesce(d.generation,0)) j on true
 where m.user_id=uid
$$;
revoke all on function public.reserve_reminder_channel(uuid,uuid,integer,text),public.reminder_channel_active(uuid,uuid,integer,text,uuid,text),public.finish_reminder_device(uuid,uuid,integer,uuid,text,boolean),public.finish_reminder_channel(uuid,uuid,integer,text,uuid,text),public.refresh_reminder_jobs(uuid) from public,anon,authenticated;
grant execute on function public.reserve_reminder_channel(uuid,uuid,integer,text),public.reminder_channel_active(uuid,uuid,integer,text,uuid,text),public.finish_reminder_device(uuid,uuid,integer,uuid,text,boolean),public.finish_reminder_channel(uuid,uuid,integer,text,uuid,text),public.refresh_reminder_jobs(uuid) to service_role;
revoke all on function private.reminder_allowed(uuid,uuid,integer,text),private.complete_reminder(uuid,uuid,integer),private.sync_reminder_channels() from public,anon,authenticated;

revoke all on function public.prepare_reminder_email(uuid,uuid,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_reminder_email(uuid,uuid,integer,uuid,jsonb) to service_role;
