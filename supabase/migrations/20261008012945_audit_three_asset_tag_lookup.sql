-- Use the database's own lower() rule for both sides of exact tag lookup.
-- The display value is never case-converted on the way back to the scanner.
create function public.inventory_asset_tag_lookup(p_tag text) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare display_tag text; result jsonb;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_tag is null or octet_length(p_tag)>1024 then
  raise exception using errcode='P1012',message='invalid_asset_tag'; end if;
 display_tag:=btrim(p_tag);
 if char_length(display_tag) not between 1 and 100 then
  raise exception using errcode='P1012',message='invalid_asset_tag'; end if;
 select jsonb_build_object('id',a.id,'name',a.name,'status',a.status,'asset_tag',a.asset_tag)
  into result from public.serialized_assets a where a.asset_tag_normalized=lower(display_tag);
 return result;
end; $$;
revoke all on function public.inventory_asset_tag_lookup(text) from public,anon,authenticated,service_role;
grant execute on function public.inventory_asset_tag_lookup(text) to authenticated;
