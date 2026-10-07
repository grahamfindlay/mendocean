-- Account email addresses are read only by the server after its administrator check.
-- Do not expose Auth metadata or copy identity data into monitoring/analytics tables.
create function public.admin_account_emails(user_ids uuid[])
returns table(id uuid, email text)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where u.id = any(user_ids)
$$;
revoke all on function public.admin_account_emails(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_account_emails(uuid[]) to service_role;
