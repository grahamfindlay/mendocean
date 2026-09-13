-- Database writes must remain valid even when clients call RPC directly.
create function private.valid_report(b jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare n integer; elem jsonb; ids integer;
begin
 if jsonb_typeof(b)<>'object' or not b ?& array['submission_id','expected_version','outcome','scope','reason','rating','route','boat_class','launched_boats','coach_state','coach_ids','coach_count','smallest_boat','largest_boat','actual_start','actual_end','notes','segments'] then return false;end if;
 if (select count(*) from jsonb_object_keys(b))<>18 then return false;end if;
 if jsonb_typeof(b->'expected_version')<>'number' or (b->>'expected_version')::integer<0 then return false;end if;
 if b->>'outcome'='rowed' and b->>'rating' is null then return false;end if;
 if b->>'outcome' is null or b->>'scope' is null or b->>'route' is null or b->>'coach_state' is null or b->>'notes' is null then return false;end if;
 if b->>'scope' not in ('personal','whole_outing') or b->>'route' not in ('east','west','both','unknown') or b->>'coach_state' not in ('known','unknown','uncoached') then return false;end if;
 if b->>'reason' is not null and b->>'reason' not in ('wind_waves','other_weather','non_weather','unknown') then return false;end if;
 if b->>'outcome'='stayed_ashore' and b->>'reason' is null then return false;end if;
 if b->>'boat_class' is not null and b->>'boat_class' not in ('1x','2x','2−','2+','4x','4−','4+','8+') then return false;end if;
 if jsonb_typeof(b->'coach_ids')<>'array' or jsonb_typeof(b->'launched_boats')<>'array' or jsonb_typeof(b->'segments')<>'array' then return false;end if;
 ids=jsonb_array_length(b->'coach_ids');if ids>30 or jsonb_array_length(b->'launched_boats')>8 or jsonb_array_length(b->'segments')>2 or length(b->>'notes')>2000 then return false;end if;
 if ids<>(select count(distinct v) from jsonb_array_elements_text(b->'coach_ids') v) then return false;end if;
 if ids>0 and (b->>'coach_count' is null or (b->>'coach_count')::int<>ids) then return false;end if;
 if b->>'coach_count' is not null and (b->>'coach_count')::int not between 0 and 30 then return false;end if;
 if b->>'coach_state'='uncoached' and (ids<>0 or b->>'coach_count' is null or (b->>'coach_count')::int<>0) then return false;end if;
 if b->>'smallest_boat' is not null and (b->>'smallest_boat')::int not in (1,2,4,8) then return false;end if;
 if b->>'largest_boat' is not null and (b->>'largest_boat')::int not in (1,2,4,8) then return false;end if;
 if (b->>'smallest_boat')::int>(b->>'largest_boat')::int then return false;end if;
 if (b->>'actual_end')::timestamptz<=(b->>'actual_start')::timestamptz then return false;end if;
 if b->>'outcome'<>'rowed' and (b->>'boat_class' is not null or b->>'smallest_boat' is not null or b->>'largest_boat' is not null or jsonb_array_length(b->'segments')>0 or jsonb_array_length(b->'launched_boats')>0) then return false;end if;
 for elem in select * from jsonb_array_elements(b->'launched_boats') loop if elem#>>'{}' not in ('1x','2x','2−','2+','4x','4−','4+','8+') then return false;end if;end loop;
 for elem in select * from jsonb_array_elements(b->'segments') loop if elem->>'route' is null or elem->>'rating' is null or elem->>'route' not in ('east','west') or (elem->>'rating')::int not between 1 and 5 then return false;end if;end loop;
 if jsonb_array_length(b->'segments')<>(select count(distinct v->>'route') from jsonb_array_elements(b->'segments') v) then return false;end if;
 return true;
 exception when others then return false;
end $$;
alter table public.reports add constraint report_json_valid check(private.valid_report(data));
alter table public.reports alter column outcome set not null;
