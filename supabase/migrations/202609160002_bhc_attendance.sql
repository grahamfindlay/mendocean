-- Record explicit attempts before calling BHC. Replayed requests only read back;
-- no background job or automatic retry may repeat an attendance write.
create table private.bhc_attendance_attempts (
 user_id uuid references public.profiles on delete cascade,
 request_id uuid not null,
 outing_id uuid not null references public.outings on delete cascade,
 attendance text not null check(attendance in ('attending','declined')),
 created_at timestamptz not null default now(),
 primary key(user_id,request_id)
);
alter table private.bhc_attendance_attempts enable row level security;
create function public.claim_bhc_attendance(uid uuid,request uuid,outing uuid,choice text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.bhc_attendance_attempts where user_id=uid and request_id=request and (outing_id<>outing or attendance<>choice)) then
  raise exception 'Attendance request cannot be reused for another change';
 end if;
 insert into private.bhc_attendance_attempts(user_id,request_id,outing_id,attendance)
 values(uid,request,outing,choice) on conflict do nothing;
 return found;
end $$;
revoke all on function public.claim_bhc_attendance(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_bhc_attendance(uuid,uuid,uuid,text) to service_role;

create function public.apply_bhc_attendance(uid uuid,outing uuid,choice text,deadline timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.outing_members m set attendance=choice,deadline=apply_bhc_attendance.deadline,
 reminder=choice='attending' and not m.skipped,synced_at=now(),
 planned_boat=case when choice='attending' then m.planned_boat else null end,
 planned_seat=case when choice='attending' then m.planned_seat else null end
 where m.user_id=uid and m.outing_id=outing;
 if choice<>'attending' then
  update private.jobs set status='cancelled' where user_id=uid and outing_id=outing and kind='reminder' and status='pending';
 else perform public.refresh_reminder_jobs(uid);
 end if;
end $$;
revoke all on function public.apply_bhc_attendance(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.apply_bhc_attendance(uuid,uuid,text,timestamptz) to service_role;
