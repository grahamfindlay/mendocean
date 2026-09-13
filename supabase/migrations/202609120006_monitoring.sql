create function public.pilot_health() returns jsonb language sql security definer set search_path='' as $$
select jsonb_build_object(
 'database_bytes',pg_database_size(current_database()),
 'weather_storage_bytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='weather-archive'),
 'failed_jobs',(select count(*) from private.jobs where status='failed'),
 'oldest_pending_job',(select min(due_at) from private.jobs where status='pending'),
 'last_weather',(select max(fetched_at) from public.weather_runs),
 'reports',(select count(*) from public.reports),
 'outings',(select count(*) from public.outings),
 'models',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'status',status,'metrics',metrics)),'[]') from private.model_runs)
) $$;
revoke all on function public.pilot_health() from public,anon,authenticated;
grant execute on function public.pilot_health() to service_role;
