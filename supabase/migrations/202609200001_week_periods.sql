-- Personal forecast display preferences. Existing own-profile SELECT policy applies;
-- writes remain restricted to the authenticated API (service role).
alter table public.profiles add column week_periods jsonb;
alter table public.profiles add constraint week_periods_array
  check (week_periods is null or (jsonb_typeof(week_periods) = 'array' and jsonb_array_length(week_periods) <= 12));
