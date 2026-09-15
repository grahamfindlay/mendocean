alter table private.deliveries add column generation integer not null default 0;
create table private.delivery_budget(user_id uuid references public.profiles on delete cascade,outing_id uuid references public.outings on delete cascade,generation integer,channel text not null,reserved_at timestamptz not null default now(),primary key(user_id,outing_id,generation));
alter table private.delivery_budget enable row level security;
create function public.reserve_delivery(uid uuid,outing uuid,gen integer,channel text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d private.deliveries; used integer;
begin
 perform pg_advisory_xact_lock(846302);
 select * into d from private.deliveries where user_id=uid and outing_id=outing for update;
 if found and (d.sent_at is not null or d.generation<>gen) then return '{"allowed":false}';end if;
 if not found then
   if gen<>0 then return '{"allowed":false}';end if;
   insert into private.deliveries(user_id,outing_id,channel) values(uid,outing,channel) returning * into d;
 end if;
 if not exists(select 1 from private.delivery_budget where user_id=uid and outing_id=outing and generation=gen) then
   if d.channel='email' then
     select count(*) into used from private.delivery_budget where private.delivery_budget.channel='email' and reserved_at>=date_trunc('day',now());
     if used>=80 then return '{"allowed":false,"quota":true}';end if;
   end if;
   insert into private.delivery_budget(user_id,outing_id,generation,channel) values(uid,outing,gen,d.channel);
 end if;
 return jsonb_build_object('allowed',true,'channel',d.channel,'generation',gen);
end $$;
create function public.reset_reminder(uid uuid,outing uuid,repeat boolean) returns integer language plpgsql security definer set search_path='' as $$
declare gen integer:=0; channel text;
begin
 update private.jobs set status='cancelled' where user_id=uid and outing_id=outing and kind='reminder' and status='pending';
 if repeat then
   select reminder_channel into channel from public.profiles where id=uid;
   insert into private.deliveries(user_id,outing_id,channel,generation) values(uid,outing,channel,1)
   on conflict(user_id,outing_id) do update set sent_at=null,reserved_at=now(),generation=private.deliveries.generation+1,channel=excluded.channel
   returning generation into gen;
 else select generation into gen from private.deliveries where user_id=uid and outing_id=outing;
 end if;
 return coalesce(gen,0);
end $$;
create function public.finish_delivery(uid uuid,outing uuid,gen integer) returns void language sql security definer set search_path='' as $$
 update private.deliveries set sent_at=now() where user_id=uid and outing_id=outing and generation=gen
$$;
revoke all on function public.reserve_delivery(uuid,uuid,integer,text),public.reset_reminder(uuid,uuid,boolean),public.finish_delivery(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.reserve_delivery(uuid,uuid,integer,text),public.reset_reminder(uuid,uuid,boolean),public.finish_delivery(uuid,uuid,integer) to service_role;
