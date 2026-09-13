create function public.release_claims(ids bigint[]) returns void language sql security definer set search_path='' as $$
 update private.jobs set status='pending',locked_at=null,attempts=greatest(0,attempts-1) where id=any(ids) and status='running'
$$;
revoke all on function public.release_claims(bigint[]) from public,anon,authenticated;
grant execute on function public.release_claims(bigint[]) to service_role;
