alter table public.outings add column actual_starts_at timestamptz;
alter table public.outings add column actual_ends_at timestamptz;
alter table public.outings add constraint actual_outing_interval check(actual_ends_at is null or actual_starts_at is null or actual_ends_at>actual_starts_at);
create function public.reconcile_outings(source uuid,target uuid,actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare conflicts integer; src public.outings; dst public.outings;
begin
 if source=target then raise exception 'Choose two different outings';end if;
 perform pg_advisory_xact_lock(846304);
 select * into src from public.outings where id=source for update;
 select * into dst from public.outings where id=target for update;
 if src.id is null or dst.id is null then raise exception 'Outing not found';end if;
 if src.kind='official' then raise exception 'Preserve the official BHC outing as the destination';end if;
 select count(*) into conflicts from public.reports a join public.reports b on a.user_id=b.user_id where a.outing_id=source and b.outing_id=target;
 if conflicts>0 then raise exception 'A person has reports on both outings. Have them resolve their duplicate before merging.';end if;
 insert into public.outing_members(outing_id,user_id,attendance,reminder,skipped,planned_boat,planned_seat,deadline,synced_at)
 select target,user_id,attendance,reminder,skipped,planned_boat,planned_seat,deadline,synced_at from public.outing_members where outing_id=source on conflict do nothing;
 update public.reports set outing_id=target,version=version+1,updated_at=now() where outing_id=source;
 update private.submissions set response=jsonb_set(response,'{outing_id}',to_jsonb(target)) where response->>'outing_id'=source::text;
 update private.outing_links set outing_id=target where outing_id=source;
 update private.jobs set status='cancelled' where outing_id=source and status in ('pending','running');
 delete from public.outings where id=source;
 insert into private.audit(actor,event,details) values(actor,'outings_reconciled',jsonb_build_object('source',source,'target',target));
 return jsonb_build_object('id',target);
end $$;
revoke all on function public.reconcile_outings(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_outings(uuid,uuid,uuid) to service_role;
create trigger outing_interval_changed after update on public.outings for each row when (
 old.starts_at is distinct from new.starts_at or old.ends_at is distinct from new.ends_at or
 old.actual_starts_at is distinct from new.actual_starts_at or old.actual_ends_at is distinct from new.actual_ends_at
) execute function private.dataset_changed();
