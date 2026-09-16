-- Only the API may project private delivery state; caller supplies its authenticated user.
create function public.reminder_states(uid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'outing_id', m.outing_id, 'sent_at', d.sent_at,
    'due_at', case when d.sent_at is null then j.due_at else null end
  )), '[]'::jsonb)
  from public.outing_members m
  left join private.deliveries d on d.user_id=m.user_id and d.outing_id=m.outing_id
  left join lateral (
    select min(j.due_at) as due_at from private.jobs j
    where j.user_id=m.user_id and j.outing_id=m.outing_id and j.kind='reminder'
      and j.status in ('pending','running') and j.expires_at>now()
      and coalesce((j.payload->>'generation')::integer,0)=coalesce(d.generation,0)
  ) j on true
  where m.user_id=uid
$$;
revoke all on function public.reminder_states(uuid) from public, anon, authenticated;
grant execute on function public.reminder_states(uuid) to service_role;
