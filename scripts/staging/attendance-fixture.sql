-- Staging only. Keep the existing published lineup scenario intact.
create or replace function public.staging_attendance_fixture(uid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.outings; c private.bhc_connections; oid uuid:='c68221b7-f064-4b4d-aec5-4b616329925e'; next_start timestamptz; signup_deadline timestamptz;
begin
 if not exists(select 1 from private.staging_environment where owner_id=uid) then raise exception 'Staging owner required';end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,710));
 select * into c from private.bhc_connections where user_id=uid;
 if c.club_id is distinct from 900000001 or c.custid is distinct from 900000002 or c.access_state is distinct from 'active' then raise exception 'Fictional staging connection required';end if;
 if exists(select 1 from private.lineup_snapshots where outing_id=oid) or exists(select 1 from private.lineup_events where outing_id=oid) then raise exception 'Attendance fixture must have no lineup history';end if;
 next_start:=(date_trunc('day',now() at time zone 'America/Chicago')+interval '2 days 7 hours 30 minutes') at time zone 'America/Chicago';
 signup_deadline:=(date_trunc('day',now() at time zone 'America/Chicago')+interval '1 day 18 hours') at time zone 'America/Chicago';
 insert into public.outings(id,kind,title,bhc_club_id,bhc_practice_id,starts_at,ends_at,planned_boat)
 values(oid,'official','Upcoming attendance test',900000001,900000004,next_start,next_start+interval '90 minutes',null)
 on conflict(id) do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at returning * into o;
 insert into public.outing_members(user_id,outing_id,attendance,bhc_revision,deadline,synced_at)
 values(uid,oid,'unknown',c.revision,signup_deadline,now()) on conflict(user_id,outing_id) do update set bhc_revision=excluded.bhc_revision,deadline=excluded.deadline,synced_at=now();
 return jsonb_build_object('outing_id',o.id,'title',o.title,'starts_at',o.starts_at,'deadline',signup_deadline);
end $$;
revoke all on function public.staging_attendance_fixture(uuid) from public,anon,authenticated;
grant execute on function public.staging_attendance_fixture(uuid) to service_role;
