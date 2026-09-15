create function public.create_outing(body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); target uuid:=(body->>'id')::uuid; result jsonb;
begin
 if uid is null then raise exception 'Authentication required';end if;
 if not exists(select 1 from public.profiles where id=uid and approved) then raise exception 'An invitation is required';end if;
 if body->>'kind'<>'independent' then raise exception 'Only independent outings may be created here';end if;
 perform pg_advisory_xact_lock(hashtextextended(target::text,0));
 if exists(select 1 from public.outings where id=target and owner_id is distinct from uid) then raise exception 'Outing access denied';end if;
 insert into public.outings(id,kind,title,owner_id,starts_at,ends_at,planned_boat) values(target,'independent',body->>'title',uid,(body->>'starts_at')::timestamptz,(body->>'ends_at')::timestamptz,body->>'planned_boat') on conflict(id) do nothing;
 insert into public.outing_members(outing_id,user_id,attendance,reminder) values(target,uid,'attending',coalesce((body->>'reminder')::boolean,false)) on conflict do nothing;
 select to_jsonb(o) into result from public.outings o where id=target;return result;
end $$;
revoke all on function public.create_outing(jsonb) from public;
grant execute on function public.create_outing(jsonb) to authenticated;
-- Defense in depth for private storage, even if a schema is accidentally exposed later.
alter table private.submissions enable row level security;
alter table private.outing_links enable row level security;
alter table private.bhc_connections enable row level security;
alter table private.push_subscriptions enable row level security;
alter table private.jobs enable row level security;
alter table private.weather_features enable row level security;
alter table private.model_runs enable row level security;
alter table private.audit enable row level security;
