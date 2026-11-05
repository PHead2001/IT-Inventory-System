-- Forward breadcrumb enrichment reuses the caller-invoker inventory_locations view.
-- Register pg_trgm's USERSET parameters in this migration connection before
-- validating the function SET clause. An installed extension alone does not load
-- its library in a fresh backend; unknown GUC placeholders require SET privilege.
select extensions.word_similarity('','');

create or replace function public.command_palette_search_v1(p_query text,p_scope text default 'active',p_purpose text default 'all')
returns jsonb language plpgsql stable security invoker
set search_path='' set statement_timeout='5s'
set pg_trgm.word_similarity_threshold='0.35' as $$
declare needle text; answer jsonb;
begin
 perform 1 from public.app_members where user_id=auth.uid() and active and role in ('viewer','staff');
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 if p_query is null or p_scope is null or p_scope not in ('active','all') or p_purpose is null or p_purpose not in ('all','move','print') then
  raise exception using errcode='P1012',message='invalid_palette_query'; end if;
 needle:=public.command_palette_normalize(p_query);
 if char_length(needle)>200 or octet_length(needle)>800 or p_query ~ '[[:cntrl:]]' or exists(
  select 1 from generate_series(128,159) n where strpos(p_query,chr(n))>0
 ) then raise exception using errcode='P1012',message='invalid_palette_query'; end if;
 if needle='' then return jsonb_build_object('version',1,'rows','[]'::jsonb,'hasMore',false); end if;
 with candidates as (
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'name'::text matched_field,0::real distance,true exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and (p_scope='all' or (r.status='active'))
 and public.command_palette_normalize(r.name)=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'name'::text matched_field,public.command_palette_normalize(r.name) operator(extensions.<->>) needle distance,false exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and char_length(needle)>=3 and (p_scope='all' or (r.status='active'))
 and public.command_palette_normalize(r.name) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.name) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'assetTag'::text matched_field,0::real distance,true exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and (p_scope='all' or (r.status='active'))
 and public.command_palette_normalize(r.asset_tag)=needle
 order by r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'assetTag'::text matched_field,public.command_palette_normalize(r.asset_tag) operator(extensions.<->>) needle distance,false exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and char_length(needle)>=3 and (p_scope='all' or (r.status='active'))
 and public.command_palette_normalize(r.asset_tag) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.asset_tag) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'serialNumber'::text matched_field,0::real distance,true exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and (p_scope='all' or (r.status='active'))
 and public.command_palette_normalize(r.serial_number)=needle
 order by r.id limit 21)
 union all
 (select 'asset'::text kind,r.id,r.name,null::text code,r.asset_tag asset_tag,r.serial_number serial_number,r.status status,'serialNumber'::text matched_field,public.command_palette_normalize(r.serial_number) operator(extensions.<->>) needle distance,false exact
 from public.serialized_assets r where (p_purpose<>'move' or r.status='active') and char_length(needle)>=3 and (p_scope='all' or (r.status='active'))
 and public.command_palette_normalize(r.serial_number) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.serial_number) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'name'::text matched_field,0::real distance,true exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and (p_scope='all' or (not r.archived))
 and public.command_palette_normalize(r.name)=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'name'::text matched_field,public.command_palette_normalize(r.name) operator(extensions.<->>) needle distance,false exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and char_length(needle)>=3 and (p_scope='all' or (not r.archived))
 and public.command_palette_normalize(r.name) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.name) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'code'::text matched_field,0::real distance,true exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and (p_scope='all' or (not r.archived))
 and public.command_palette_normalize(r.item_code)=needle
 order by r.id limit 21)
 union all
 (select 'quantity'::text kind,r.id,r.name,r.item_code code,null::text asset_tag,null::text serial_number,case when r.archived then 'archived' else 'active' end status,'code'::text matched_field,public.command_palette_normalize(r.item_code) operator(extensions.<->>) needle distance,false exact
 from public.quantity_items r where (p_purpose<>'move' or not r.archived) and char_length(needle)>=3 and (p_scope='all' or (not r.archived))
 and public.command_palette_normalize(r.item_code) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.item_code) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,0::real distance,true exact
 from public.locations r where p_purpose in ('all','print') and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.name)=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,public.command_palette_normalize(r.name) operator(extensions.<->>) needle distance,false exact
 from public.locations r where p_purpose in ('all','print') and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.name) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.name) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,0::real distance,true exact
 from public.locations r where p_purpose in ('all','print') and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.code)=needle
 order by r.id limit 21)
 union all
 (select 'location'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,public.command_palette_normalize(r.code) operator(extensions.<->>) needle distance,false exact
 from public.locations r where p_purpose in ('all','print') and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.code) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.code) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,0::real distance,true exact
 from public.sites r where p_purpose='all' and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.name)=needle and char_length(needle)>=3
 order by r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'name'::text matched_field,public.command_palette_normalize(r.name) operator(extensions.<->>) needle distance,false exact
 from public.sites r where p_purpose='all' and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.name) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.name) operator(extensions.<->>) needle,r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,0::real distance,true exact
 from public.sites r where p_purpose='all' and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.code)=needle
 order by r.id limit 21)
 union all
 (select 'site'::text kind,r.id,r.name,r.code code,null::text asset_tag,null::text serial_number,case when r.active then 'active' else 'inactive' end status,'code'::text matched_field,public.command_palette_normalize(r.code) operator(extensions.<->>) needle distance,false exact
 from public.sites r where p_purpose='all' and char_length(needle)>=3 and (p_scope='all' or (r.active))
 and public.command_palette_normalize(r.code) operator(extensions.%>) needle
 order by public.command_palette_normalize(r.code) operator(extensions.<->>) needle,r.id limit 21)
 ), best as (
 select distinct on (kind,id) * from candidates
 order by kind,id,exact desc,distance,matched_field
 ), capped as (
 select *,row_number() over(order by exact desc,distance,kind,id) position from best
 order by exact desc,distance,kind,id limit 21
 )
 select jsonb_build_object('version',1,
 'rows',coalesce(jsonb_agg(jsonb_build_object('kind',capped.kind,'id',capped.id,'name',capped.name,'code',capped.code,
 'assetTag',asset_tag,'serialNumber',serial_number,'status',status,'matchedField',matched_field,'breadcrumb',case when capped.kind='location' and capped.position<=20 then (select l.breadcrumb from public.inventory_locations l where l.id=capped.id) else null end,'context',context)
 order by position) filter(where position<=20),'[]'::jsonb),
 'hasMore',count(*)>20) into answer from capped
 left join lateral (
   select case when capped.kind in ('asset','quantity') then jsonb_build_object(
     'places',coalesce(jsonb_agg(jsonb_build_object('kind',place.kind,'id',place.id,'name',place.name,'code',place.code,'breadcrumb',case when place.position<=3 and place.kind='location' then (select l.breadcrumb from public.inventory_locations l where l.id=place.id) else null end)
       order by place.kind,place.id) filter(where place.position<=3),'[]'::jsonb),
     'hasMore',count(*)>3) else null end context
   from (
     select visible.*,row_number() over(order by visible.kind,visible.id) position from (
       select authorized.* from (
         select 'location'::text kind,l.id,l.name,l.code from public.serialized_assets a
           join public.locations l on l.id=a.location_id where capped.position<=20 and capped.kind='asset' and a.id=capped.id
         union all
         select 'site'::text kind,s.id,s.name,s.code from public.serialized_assets a
           join public.sites s on s.id=a.site_id where capped.position<=20 and capped.kind='asset' and a.id=capped.id
         union all
         (select 'location'::text kind,l.id,l.name,l.code from public.stock_balances b
           join public.locations l on l.id=b.location_id where capped.position<=20 and capped.kind='quantity' and b.item_id=capped.id and b.quantity>0
           order by l.id limit 4)
         union all
         (select 'site'::text kind,s.id,s.name,s.code from public.site_quantity_holdings h
           join public.sites s on s.id=h.site_id where capped.position<=20 and capped.kind='quantity' and h.item_id=capped.id and h.quantity>0
           order by s.id limit 4)
       ) authorized order by kind,id limit 4
     ) visible
   ) place
 ) context_summary on capped.position<=20;
 if octet_length(answer::text)>65536 then
  raise exception using errcode='P1025',message='palette_response_too_large'; end if;
 return answer;
end; $$;
revoke all on function public.command_palette_search_v1(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.command_palette_search_v1(text,text,text) to authenticated;
