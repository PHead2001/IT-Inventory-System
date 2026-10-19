-- Expression-index maintenance runs as the already-authorized table writer.
-- This immutable invoker helper only normalizes its text argument; it reads no
-- data and grants no search/table access. Preserve PUBLIC/anon denial and the
-- separate service_role denial on command_palette_search_v1.
grant execute on function public.command_palette_normalize(text) to service_role;
