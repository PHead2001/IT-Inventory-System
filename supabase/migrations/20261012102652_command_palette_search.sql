-- Additive caller-authorized bounded palette search. No inventory writes.
create extension if not exists pg_trgm with schema extensions;
create index command_palette_asset_name_gist on public.serialized_assets
 using gist ((lower(btrim(coalesce(name,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_asset_asset_tag_gist on public.serialized_assets
 using gist ((lower(btrim(coalesce(asset_tag,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_asset_serial_number_gist on public.serialized_assets
 using gist ((lower(btrim(coalesce(serial_number,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_quantity_name_gist on public.quantity_items
 using gist ((lower(btrim(coalesce(name,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_quantity_item_code_gist on public.quantity_items
 using gist ((lower(btrim(coalesce(item_code,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_location_name_gist on public.locations
 using gist ((lower(btrim(coalesce(name,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_location_code_gist on public.locations
 using gist ((lower(btrim(coalesce(code,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_site_name_gist on public.sites
 using gist ((lower(btrim(coalesce(name,'')))) extensions.gist_trgm_ops(siglen=32));
create index command_palette_site_code_gist on public.sites
 using gist ((lower(btrim(coalesce(code,'')))) extensions.gist_trgm_ops(siglen=32));

create function public.command_palette_search_v1(p_query text,p_scope text default 'active',p_purpose text default 'all')
returns jsonb language plpgsql stable security invoker
set search_path='' set statement_timeout='5s'
set pg_trgm.word_similarity_threshold='0.35' as $$
declare needle text; answer jsonb;
 whitespace text:=chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||' '||chr(133)||chr(160)||
 chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||
 chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||
 chr(8239)||chr(8287)||chr(12288)||chr(65279);
begin
 perform 1 from public.app_members where user_id=auth.uid() and active and role in ('viewer','staff');
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_query is null or p_scope is null or p_scope not in ('active','all') or p_purpose is null or p_purpose not in ('all','move','print') then
  raise exception using errcode='P1012',message='invalid_palette_query'; end if;
 needle:=lower(btrim(p_query,whitespace));
 if char_length(needle)>200 or octet_length(needle)>800 or p_query ~ '[[:cntrl:]]' or exists(
  select 1 from generate_series(128,159) n where strpos(p_query,chr(n))>0
 ) then raise exception using errcode='P1012',message='invalid_palette_query'; end if;
 if needle='' then return jsonb_build_object('version',1,'rows','[]'::jsonb,'hasMore',false); end if;
 with candidates as (
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'name'::text matched_field,0::real distance,true exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and (p_scope='all' or (r.status='active'))
 and lower(btrim(coalesce(r.name,'')))=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'name'::text matched_field,lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle distance,false exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and char_length(needle)>=3 and (p_scope='all' or (r.status='active'))
 and lower(btrim(coalesce(r.name,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'assetTag'::text matched_field,0::real distance,true exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and (p_scope='all' or (r.status='active'))
 and lower(btrim(coalesce(r.asset_tag,'')))=needle
 order by r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'assetTag'::text matched_field,lower(btrim(coalesce(r.asset_tag,''))) operator(extensions.<->>) needle distance,false exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and char_length(needle)>=3 and (p_scope='all' or (r.status='active'))
 and lower(btrim(coalesce(r.asset_tag,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.asset_tag,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'serialNumber'::text matched_field,0::real distance,true exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and (p_scope='all' or (r.status='active'))
 and lower(btrim(coalesce(r.serial_number,'')))=needle
 order by r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'serialNumber'::text matched_field,lower(btrim(coalesce(r.serial_number,''))) operator(extensions.<->>) needle distance,false exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and char_length(needle)>=3 and (p_scope='all' or (r.status='active'))
 and lower(btrim(coalesce(r.serial_number,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.serial_number,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'name'::text matched_field,0::real distance,true exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and (p_scope='all' or (not r.archived))
 and lower(btrim(coalesce(r.name,'')))=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'name'::text matched_field,lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle distance,false exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and char_length(needle)>=3 and (p_scope='all' or (not r.archived))
 and lower(btrim(coalesce(r.name,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'code'::text matched_field,0::real distance,true exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and (p_scope='all' or (not r.archived))
 and lower(btrim(coalesce(r.item_code,'')))=needle
 order by r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'code'::text matched_field,lower(btrim(coalesce(r.item_code,''))) operator(extensions.<->>) needle distance,false exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and char_length(needle)>=3 and (p_scope='all' or (not r.archived))
 and lower(btrim(coalesce(r.item_code,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.item_code,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,0::real distance,true exact
 from public.locations r where p_purpose in ('all','print') and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.name,'')))=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle distance,false exact
 from public.locations r where p_purpose in ('all','print') and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.name,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,0::real distance,true exact
 from public.locations r where p_purpose in ('all','print') and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.code,'')))=needle
 order by r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,lower(btrim(coalesce(r.code,''))) operator(extensions.<->>) needle distance,false exact
 from public.locations r where p_purpose in ('all','print') and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.code,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.code,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,0::real distance,true exact
 from public.sites r where p_purpose='all' and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.name,'')))=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle distance,false exact
 from public.sites r where p_purpose='all' and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.name,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.name,''))) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,0::real distance,true exact
 from public.sites r where p_purpose='all' and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.code,'')))=needle
 order by r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,lower(btrim(coalesce(r.code,''))) operator(extensions.<->>) needle distance,false exact
 from public.sites r where p_purpose='all' and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and lower(btrim(coalesce(r.code,''))) operator(extensions.%>) needle
 order by lower(btrim(coalesce(r.code,''))) operator(extensions.<->>) needle,r.id limit 21)
 ), best as (
 select distinct on (kind,id) * from candidates
 order by kind,id,exact desc,distance,matched_field
 ), capped as (
 select *,row_number() over(order by exact desc,distance,kind,id) position from best
 order by exact desc,distance,kind,id limit 21
 )
 select jsonb_build_object('version',1,
 'rows',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',id,'name',name,'code',code,
 'assetTag',asset_tag,'serialNumber',serial_number,'status',status,'matchedField',matched_field)
 order by position) filter(where position<=20),'[]'::jsonb),
 'hasMore',count(*)>20) into answer from capped;
 if octet_length(answer::text)>65536 then
  raise exception using errcode='P1025',message='palette_response_too_large'; end if;
 return answer;
end; $$;
revoke all on function public.command_palette_search_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.command_palette_search_v1(text,text,text) to authenticated;
