-- Invitation status is enforced in the database as well as hosted Auth settings.
alter table public.profiles add column approved boolean not null default false;
create or replace function public.is_outing_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.outing_members m join public.profiles p on p.id=m.user_id where m.outing_id=target and m.user_id=auth.uid() and p.approved)
$$;
