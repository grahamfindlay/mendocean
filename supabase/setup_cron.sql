-- Run after the Edge Functions are deployed and the two Vault secrets exist.
-- Add mendocean_project_url and mendocean_jobs_secret in Supabase Vault first.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule(
 'mendocean-dispatch',
 '*/5 * * * *',
 $$select net.http_post(
   url := (select decrypted_secret from vault.decrypted_secrets where name='mendocean_project_url') || '/functions/v1/jobs',
   headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='mendocean_jobs_secret')),
   body := '{"action":"tick"}'::jsonb,
   timeout_milliseconds := 180000
 );$$
);
