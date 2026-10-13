-- Read-only exact serial discovery. Duplicates remain legal; the 21st row is
-- an overflow sentinel for the application's deliberate, bounded chooser.
create function public.inventory_serial_lookup_v1(p_serial text) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare display_serial text; result jsonb;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_serial is null or octet_length(p_serial)>1024 then
  raise exception using errcode='P1012',message='invalid_serial'; end if;
 display_serial:=regexp_replace(p_serial,'^\s+|\s+$','','g');
 if char_length(display_serial) not between 1 and 200
    or display_serial ~ ('[[:cntrl:]'||chr(127)||'-'||chr(159)||']') then
  raise exception using errcode='P1012',message='invalid_serial'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',a.id,'name',a.name,'status',a.status,'asset_tag',a.asset_tag,
  'serial_number',a.serial_number,'manufacturer',a.manufacturer,
  'location_name',l.name,'location_code',l.code,'site_name',s.name,'site_code',s.code
 ) order by a.id),'[]'::jsonb) into result
 from (select asset.id,asset.name,asset.status,asset.asset_tag,asset.serial_number,
       asset.manufacturer,asset.location_id,asset.site_id
       from public.serialized_assets asset
       where lower(asset.serial_number)=lower(display_serial)
       order by asset.id limit 21) a
 left join public.locations l on l.id=a.location_id
 left join public.sites s on s.id=a.site_id;
 return result;
end; $$;
revoke all on function public.inventory_serial_lookup_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.inventory_serial_lookup_v1(text) to authenticated;
