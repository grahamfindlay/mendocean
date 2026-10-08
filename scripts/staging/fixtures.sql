-- Staging only: installed by the guarded staging tool, never by production migrations.
create table if not exists private.staging_environment(id boolean primary key default true check(id),owner_id uuid not null references public.profiles);
alter table private.staging_environment enable row level security;
revoke all on private.staging_environment from public,anon,authenticated;
create or replace function public.staging_fixture(uid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.outings; c private.bhc_connections; oid uuid:='e746607c-f17f-4f59-833e-267f21fb7802'; next_start timestamptz;
begin
 if not exists(select 1 from private.staging_environment where owner_id=uid) then raise exception 'Staging owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,710));
 next_start:=(date_trunc('day',now() at time zone 'America/Chicago')+interval '1 day 7 hours 30 minutes') at time zone 'America/Chicago';
 insert into private.bhc_settings(club_id) values(900000001) on conflict(id) do nothing;
 insert into private.bhc_connections(user_id,ciphertext,iv,custid,club_id,method,import_status,revision,last_successful_sync_at)
 values(uid,'staging-only-no-real-credential','staging',900000002,900000001,'provided_token','complete',1,now())
 on conflict(user_id) do update set revoked_at=null,access_state='active',expires_at=null,import_status='complete';
 update private.bhc_connections set sync_locked_until=now()+interval '2 minutes',last_successful_sync_at=now(),lineup_error=null where user_id=uid returning * into c;
 insert into public.outings(id,kind,title,bhc_club_id,bhc_practice_id,starts_at,ends_at,planned_boat)
 values(oid,'official','Masters Recreational',900000001,900000003,next_start,next_start+interval '90 minutes','4+')
 on conflict(id) do update set title=excluded.title,starts_at=case when public.outings.ends_at<now() or public.outings.title like 'TEST %' then excluded.starts_at else public.outings.starts_at end,
 ends_at=case when public.outings.ends_at<now() or public.outings.title like 'TEST %' then excluded.ends_at else public.outings.ends_at end returning * into o;
 insert into public.outing_members(user_id,outing_id,attendance,bhc_revision,deadline,synced_at)
 values(uid,oid,'attending',c.revision,o.starts_at,now()) on conflict(user_id,outing_id) do update set attendance='attending',bhc_revision=excluded.bhc_revision,deadline=excluded.deadline,synced_at=now();
 return jsonb_build_object('outing',o.id,'athlete',c.custid,'revision',c.revision,'starts_at',o.starts_at,'ends_at',o.ends_at,'title',o.title);
end $$;
create or replace function public.staging_delay(uid uuid) returns integer language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 if not exists(select 1 from private.staging_environment where owner_id=uid) then raise exception 'Staging owner required';end if;
 update private.jobs set due_at=now()+interval '30 seconds' where user_id=uid and kind='lineup_notify' and status='pending';get diagnostics n=row_count;return n;
end $$;
create or replace function public.staging_claim() returns jsonb language sql security definer set search_path='' as $$
 with candidates as (select j.id from private.jobs j join private.staging_environment s on s.owner_id=j.user_id
 where j.kind='lineup_notify' and j.due_at<=now() and j.expires_at>now() and j.attempts<5
 and (j.status='pending' or (j.status='running' and j.locked_at<now()-interval '5 minutes')) order by j.id for update of j skip locked limit 10),
 claimed as (update private.jobs j set status='running',locked_at=now(),attempts=attempts+1 from candidates c where j.id=c.id returning j.*)
 select coalesce(jsonb_agg(claimed),'[]') from claimed
$$;
revoke all on function public.staging_fixture(uuid),public.staging_delay(uuid),public.staging_claim() from public,anon,authenticated;
grant execute on function public.staging_fixture(uuid),public.staging_delay(uuid),public.staging_claim() to service_role;
