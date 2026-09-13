insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('weather-archive','weather-archive',false,5242880,array['application/gzip']) on conflict(id) do nothing;
