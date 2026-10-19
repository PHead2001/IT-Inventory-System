begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','command_palette_search_v1',array['text','text','text']);
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.inventory_locations'::regclass),'canonical breadcrumb view retains caller RLS');

select ok(not has_function_privilege(role_name,'public.command_palette_search_v1(text,text,text)','EXECUTE'),role_name||' cannot search')
 from (values ('anon'),('service_role')) roles(role_name);
select ok(has_function_privilege('authenticated','public.command_palette_search_v1(text,text,text)','EXECUTE'),'caller role can reach membership guard');
select ok(has_function_privilege(role_name,'public.command_palette_normalize(text)','EXECUTE'),role_name||' can normalize text for authorized expression-index maintenance')
 from (values ('authenticated'),('service_role')) roles(role_name);
select ok(not has_function_privilege('anon','public.command_palette_normalize(text)','EXECUTE'),'anonymous cannot invoke the normalization helper');
select ok(not exists(
 select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) privilege
 where p.oid=signature::regprocedure and privilege.grantee=0 and privilege.privilege_type='EXECUTE'
),'PUBLIC has no EXECUTE grant on '||signature)
 from (values ('public.command_palette_normalize(text)'),('public.command_palette_search_v1(text,text,text)')) functions(signature);
select ok((select not prosecdef and provolatile='i' and proparallel='s' and proconfig @> array['search_path=""'] from pg_proc
 where oid='public.command_palette_normalize(text)'::regprocedure),'normalizer retains immutable parallel-safe invoker execution with empty search path');
set local role service_role;
select is(public.command_palette_normalize(chr(160)||'PaLeTtE'||chr(65279)),'palette','service role can execute pure Unicode normalization required by indexed writes');
select throws_ok($$select public.command_palette_search_v1('Palette')$$,'42501','permission denied for function command_palette_search_v1','helper grant does not authorize service-role palette search');
reset role;
select ok((select not prosecdef and proconfig @> array['search_path=""','statement_timeout=5s','pg_trgm.word_similarity_threshold=0.35'] from pg_proc
 where oid='public.command_palette_search_v1(text,text,text)'::regprocedure),'invoker, empty search path and timeout declaration');

insert into auth.users(id,email) values
 ('a3010000-0000-4000-8000-000000000001','palette-staff@example.test'),
 ('a3010000-0000-4000-8000-000000000002','palette-viewer@example.test'),
 ('a3010000-0000-4000-8000-000000000003','palette-inactive@example.test'),
 ('a3010000-0000-4000-8000-000000000004','palette-nonmember@example.test');
insert into public.app_members(user_id,display_name,role,active) values
 ('a3010000-0000-4000-8000-000000000001','Palette staff','staff',true),
 ('a3010000-0000-4000-8000-000000000002','Palette viewer','viewer',true),
 ('a3010000-0000-4000-8000-000000000003','Palette inactive','staff',false);
insert into public.quantity_items(id,name,item_code,category_id,archived) values
 ('a3010000-0000-4000-8000-000000000010','Palette zero stock','PAL-ZERO',(select id from public.categories where code='OTHER'),false),
 ('a3010000-0000-4000-8000-000000000011','Palette multiple holdings','PAL-MULTI',(select id from public.categories where code='OTHER'),false),
 ('a3010000-0000-4000-8000-000000000012','Palette archived','PAL-ARCHIVED',(select id from public.categories where code='OTHER'),true);
insert into public.stock_balances(item_id,location_id,quantity)
 select 'a3010000-0000-4000-8000-000000000011',id,2 from public.locations where code in ('ITC-D01','ITC-D02');
insert into public.serialized_assets(id,name,asset_tag,serial_number,category_id,location_id,status) values
 ('a3010000-0000-4000-8000-000000000020','Palette laptop one','PAL-ONE','PAL-DUPLICATE',(select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01'),'active'),
 ('a3010000-0000-4000-8000-000000000021','Palette laptop two','PAL-TWO','PAL-DUPLICATE',(select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01'),'active'),
 ('a3010000-0000-4000-8000-000000000022','Palette retired','PAL-RETIRED','PAL-OLD',(select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01'),'retired');
insert into public.sites(id,code,name,active) values
 ('a3010000-0000-4000-8000-000000000030','PAL-EMPTY','Palette empty site',true),
 ('a3010000-0000-4000-8000-000000000031','PAL-INACTIVE','Palette inactive site',false);
-- Ties exceed both the output cap and the earlier substring page.
insert into public.quantity_items(id,name,category_id)
 select ('a3010000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'PaletteTies',
 (select id from public.categories where code='OTHER') from generate_series(100,135) n;
-- Retain 6,000 common Calibration/PAL-BULK matches per table for adversarial
-- equal-distance ranking/cap coverage. A selective token in 30 rows per field
-- (more than the 21-candidate sentinel) supplies the distinct KNN plan workload.
insert into public.quantity_items(name,item_code,category_id)
 select 'Calibration '||case when n<=30 then 'Spectrometer ' else '' end||'fixture filler '||n,
 'PAL-BULK-'||case when n<=30 then 'RIVET-' else '' end||'ITEM-'||n,
 (select id from public.categories where code='OTHER') from generate_series(1,6000) n;
insert into public.serialized_assets(name,asset_tag,serial_number,category_id,location_id)
 select 'Calibration '||case when n<=30 then 'Spectrometer ' else '' end||'asset filler '||n,
 'PAL-BULK-'||case when n<=30 then 'RIVET-' else '' end||'ASSET-'||n,
 'PAL-BULK-'||case when n<=30 then 'RIVET-' else '' end||'SERIAL-'||n,
 (select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01') from generate_series(1,6000) n;
insert into public.sites(code,name)
 select 'PAL-BULK-'||case when n<=30 then 'RIVET-' else '' end||'SITE-'||n,
 'Calibration '||case when n<=30 then 'Spectrometer ' else '' end||'site filler '||n from generate_series(1,6000) n;
insert into public.locations(code,name,parent_id,kind,can_hold_inventory)
 select 'PAL-BULK-'||case when n<=30 then 'RIVET-' else '' end||'LOC-'||n,
 'Calibration '||case when n<=30 then 'Spectrometer ' else '' end||'location filler '||n,
 (select id from public.locations where code='ITC'),'container',true from generate_series(1,6000) n;
insert into public.quantity_items(id,name,category_id) values
 ('a3010000-0000-4000-8000-000000009999','PaletteCalibration instrument',(select id from public.categories where code='OTHER'));
-- Exact site matches fill an ordinary page before a fuzzy equipment match.
-- Location matches also crowd search while keeping active sibling names distinct.
insert into public.locations(code,name,parent_id,kind,can_hold_inventory)
 select 'PAL-PURPOSE-LOC-'||n,'PurposeCrowd '||n,(select id from public.locations where code='ITC'),'container',true from generate_series(1,25) n;
insert into public.sites(code,name)
 select 'PAL-PURPOSE-SITE-'||n,'PurposeCrowd' from generate_series(1,25) n;
insert into public.sites(code,name)
 select 'PAL-PRINT-SITE-'||n,'QuasarHatch' from generate_series(1,25) n;
insert into public.serialized_assets(id,name,asset_tag,category_id,location_id) values
 ('a3010000-0000-4000-8000-000000008001','PurposeCrowd equipment','PAL-PURPOSE-ASSET',(select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01')),
 ('a3010000-0000-4000-8000-000000008002','QuasarHatch equipment','PAL-PRINT-ASSET',(select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01'));
insert into public.quantity_items(id,name,item_code,category_id) values
 ('a3010000-0000-4000-8000-000000000013','Palette many places','PAL-MANY',(select id from public.categories where code='OTHER'));
insert into public.stock_balances(item_id,location_id,quantity)
 select 'a3010000-0000-4000-8000-000000000013',id,1 from public.locations where code in ('ITC-D01','ITC-D02','ITC-D03','ITC-D04');
-- Context and Unicode normalization regressions use owned rows only.
insert into public.serialized_assets(id,name,serial_number,category_id,location_id,status) values
 ('a3010000-0000-4000-8000-000000000023','Palette Unicode',chr(160)||'Z9'||chr(65279),(select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01'),'active');
insert into public.serialized_assets(id,name,asset_tag,category_id,site_id,status) values
 ('a3010000-0000-4000-8000-000000000024','Palette site asset','PAL-SITE-ASSET',(select id from public.categories where code='OTHER'),'a3010000-0000-4000-8000-000000000030','active');
insert into public.site_quantity_holdings(item_id,site_id,quantity) values
 ('a3010000-0000-4000-8000-000000000011','a3010000-0000-4000-8000-000000000030',1);
insert into public.locations(id,code,name,parent_id,kind,can_hold_inventory) values
 ('a3010000-0000-4000-8000-000000000040','PAL-PATH-WEST','Palette west',(select id from public.locations where code='ITC'),'storage_group',false),
 ('a3010000-0000-4000-8000-000000000041','PAL-PATH-EAST','Palette east',(select id from public.locations where code='ITC'),'storage_group',false),
 ('a3010000-0000-4000-8000-000000000042','PAL-PATH-A','Palette duplicate drawer','a3010000-0000-4000-8000-000000000040','drawer',true),
 ('a3010000-0000-4000-8000-000000000043','PAL-PATH-B','Palette duplicate drawer','a3010000-0000-4000-8000-000000000041','drawer',true);
insert into public.quantity_items(id,name,item_code,category_id) values
 ('a3010000-0000-4000-8000-000000000014','Palette path holdings','PAL-PATH-ITEM',(select id from public.categories where code='OTHER'));
insert into public.stock_balances(item_id,location_id,quantity) values
 ('a3010000-0000-4000-8000-000000000014','a3010000-0000-4000-8000-000000000042',1),
 ('a3010000-0000-4000-8000-000000000014','a3010000-0000-4000-8000-000000000043',1);
analyze public.quantity_items;
analyze public.serialized_assets;
analyze public.locations;
analyze public.sites;
select set_config('request.jwt.claims','{"sub":"a3010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.command_palette_search_v1('  ')->'rows','[]'::jsonb,'blank query is empty');
select is(public.command_palette_search_v1('PAL-PATH-A')->'rows'->0->>'breadcrumb','IT Closet / Palette west / Palette duplicate drawer','location result distinguishes identical leaf names by full authorized path');
select is(public.command_palette_search_v1('PAL-PATH-B')->'rows'->0->>'breadcrumb','IT Closet / Palette east / Palette duplicate drawer','other parent retains its distinct full breadcrumb');
select is(public.command_palette_search_v1('PAL-PATH-ITEM')->'rows'->0->'context'->'places'->0->>'breadcrumb','IT Closet / Palette west / Palette duplicate drawer','first bounded holding has canonical breadcrumb');
select is(public.command_palette_search_v1('PAL-PATH-ITEM')->'rows'->0->'context'->'places'->1->>'breadcrumb','IT Closet / Palette east / Palette duplicate drawer','second bounded holding has distinct canonical breadcrumb');

select is(public.command_palette_normalize(chr(160)||'Z9'||chr(65279)),'z9','same immutable Unicode trim for query, indexed fields and exact match');
select is(public.command_palette_normalize(chr(code)||'Z9'||chr(code)),'z9','explicit Unicode normalization codepoint '||code) from (values (9),(10),(11),(12),(13),(32),(160),(5760),(8192),(8193),(8194),(8195),(8196),(8197),(8198),(8199),(8200),(8201),(8202),(8232),(8233),(8239),(8287),(12288),(65279)) whitespace(code);

select is(public.command_palette_search_v1('Z9')->'rows'->0->>'id','a3010000-0000-4000-8000-000000000023','NBSP and BOM stored short serial finds exact asset');
select is(public.command_palette_search_v1(chr(160)||'Z9'||chr(65279))->'rows'->0->>'id','a3010000-0000-4000-8000-000000000023','Unicode trimmed query uses the same normalized field');
select is(public.command_palette_search_v1('PAL-ZERO')->'rows'->0->'context','{"places":[],"hasMore":false}'::jsonb,'zero stock explicitly has no current context');
select is(public.command_palette_search_v1('PAL-ONE')->'rows'->0->'context'->'places'->0->>'code','ITC-D01','asset context uses current physical storage');
select is(public.command_palette_search_v1('PAL-SITE-ASSET')->'rows'->0->'context'->'places'->0->>'kind','site','site-held asset uses current custody');
-- Longer identifier queries also return legitimate fuzzy neighbors. Count the
-- owned entity rather than assuming exact matches suppress those neighbors.
select is((select count(*) from jsonb_array_elements(public.command_palette_search_v1('PAL-MULTI')->'rows') r
 where r->>'kind'='quantity' and r->>'id'='a3010000-0000-4000-8000-000000000011'),1::bigint,'mixed storage/site holdings still produce one quantity entity');
select is(jsonb_array_length(public.command_palette_search_v1('PAL-MULTI')->'rows'->0->'context'->'places'),3,'mixed quantity context contains bounded storage and site places');
select is(public.command_palette_search_v1('PAL-MULTI')->'rows'->0->'context'->>'hasMore','false','three authorized places have no fourth sentinel');
select is(jsonb_array_length(public.command_palette_search_v1('PAL-MANY')->'rows'->0->'context'->'places'),3,'more than three places are clipped before response aggregation');
select is(public.command_palette_search_v1('PAL-MANY')->'rows'->0->'context'->>'hasMore','true','fourth authorized place yields explicit more context');


select throws_ok($$select public.command_palette_search_v1(null)$$,'P1012','invalid_palette_query','null query rejected');
select throws_ok($$select public.command_palette_search_v1('Palette','hidden')$$,'P1012','invalid_palette_query','unknown lifecycle scope rejected');
select throws_ok($$select public.command_palette_search_v1('Palette','active','hidden')$$,'P1012','invalid_palette_query','unknown purpose rejected');
select throws_ok($$select public.command_palette_search_v1(repeat('a',201))$$,'P1012','invalid_palette_query','overlong query rejected');
select throws_ok($$select public.command_palette_search_v1('x'||chr(9))$$,'P1012','invalid_palette_query','controls rejected before trimming');
select is(jsonb_array_length(public.command_palette_search_v1('PA')->'rows'),0,'short nonexact query returns no fuzzy names');
select is(public.command_palette_search_v1('pal-zero')->'rows'->0->>'id','a3010000-0000-4000-8000-000000000010','zero-stock definition included');
select is((select count(*) from jsonb_array_elements(public.command_palette_search_v1('PAL-MULTI')->'rows') r),
 (select count(distinct (r->>'kind',r->>'id')) from jsonb_array_elements(public.command_palette_search_v1('PAL-MULTI')->'rows') r),'holdings and fuzzy field matches do not duplicate any entity');
select results_eq($$select r->>'id' from jsonb_array_elements(public.command_palette_search_v1('PAL-DUPLICATE')->'rows') r
 where r->>'kind'='asset' and r->>'serialNumber'='PAL-DUPLICATE' order by r->>'id'$$,
 $$values ('a3010000-0000-4000-8000-000000000020'::text),('a3010000-0000-4000-8000-000000000021'::text)$$,'duplicate serials remain separate named assets alongside fuzzy neighbors');
select ok(extensions.word_similarity('pal-multi','pal-bulk-item-1')>0.35,'shared identifier prefix is a legitimate fuzzy neighbor');
select ok(exists(select 1 from jsonb_array_elements(public.command_palette_search_v1('PAL-MULTI')->'rows') r
 where r->>'id'<>'a3010000-0000-4000-8000-000000000011'),'an exact identifier match retains eligible fuzzy neighbors');
select is(public.command_palette_search_v1('PAL-EMPTY')->'rows'->0->>'kind','site','empty site included');
select is(public.command_palette_search_v1('ITC-D01')->'rows'->0->>'kind','location','empty/aggregate-independent logical location included');
select is(public.command_palette_search_v1('PAL-RETIRED','all')->'rows'->0->>'status','retired','historical scope marks retired assets');
select is(public.command_palette_search_v1('PAL-ARCHIVED','all')->'rows'->0->>'status','archived','historical scope marks archived definitions');
select is(public.command_palette_search_v1('PAL-INACTIVE','all')->'rows'->0->>'status','inactive','historical scope marks inactive sites');
select ok(not exists(select 1 from jsonb_array_elements(public.command_palette_search_v1('PAL','active')->'rows') r
 where r->>'status'<>'active'),'active scope excludes every historical lifecycle');
select is(public.command_palette_search_v1('paletecalibration')->'rows'->0->>'id','a3010000-0000-4000-8000-000000009999','true typo match beyond old substring/page approach');
select is(jsonb_array_length(public.command_palette_search_v1('PaletteTies')->'rows'),20,'unique entity cap is 20');
select is(public.command_palette_search_v1('PaletteTies')->>'hasMore','true','21st unique entity sets cap guidance');
select is(public.command_palette_search_v1('PaletteTies')->'rows'->0->>'id','a3010000-0000-4000-8000-000000000100','ties use deterministic entity identity');
select is(public.command_palette_search_v1('PaletteTies'),public.command_palette_search_v1('PaletteTies'),'repeat rank stable');
-- Common terms still exercise all 6,000 equal-distance rows in each field.
-- The separate selective plan probe must not erase this ranking workload.
create temporary table palette_common_results as
 select query,public.command_palette_search_v1(query) answer
 from (values ('calibration'),('pal-bulk')) terms(query);
select is(jsonb_array_length(answer->'rows'),20,'6,000-row common term keeps the entity cap: '||query) from palette_common_results;
select is(answer->>'hasMore','true','6,000-row common term retains overflow guidance: '||query) from palette_common_results;
select results_eq($$select r->>'id' from palette_common_results p cross join lateral jsonb_array_elements(p.answer->'rows') with ordinality result(r,position)
 where p.query='calibration' order by position$$,
 $$select id::text from public.serialized_assets where name like 'Calibration %' order by id limit 20$$,'common name ties keep the first twenty entity identities');
select results_eq($$select r->>'id' from palette_common_results p cross join lateral jsonb_array_elements(p.answer->'rows') with ordinality result(r,position)
 where p.query='pal-bulk' order by position$$,
 $$select id::text from public.serialized_assets where asset_tag like 'PAL-BULK-%' order by id limit 20$$,'common identifier ties keep the first twenty deduplicated entity identities');
select is(jsonb_array_length(public.command_palette_search_v1('PurposeCrowd')->'rows'),20,'unique sibling fixtures still fill the ordinary purpose search cap');
select is(public.command_palette_search_v1('PurposeCrowd')->>'hasMore','true','ordinary purpose search retains more irrelevant matches beyond the cap');
select ok(not exists(select 1 from jsonb_array_elements(public.command_palette_search_v1('PurposeCrowd')->'rows') r where r->>'kind'='asset'),'ordinary cap is full of higher-ranked locations/sites');
select is(public.command_palette_search_v1('PurposeCrowd','active','move')->'rows'->0->>'id','a3010000-0000-4000-8000-000000008001','move purpose selects eligible kinds before per-field/global caps');
select is(public.command_palette_search_v1('PurposeCrowd','active','move')->>'hasMore','false','irrelevant location/site matches do not set move hasMore');
select ok(extensions.word_similarity('quasarhatch','PurposeCrowd 1')<0.35,'print crowd fixture does not also match eligible purpose-crowd locations');
select is(public.command_palette_search_v1('QuasarHatch')->>'hasMore','true','ordinary search retains the excluded-site crowd beyond the cap');
select is(public.command_palette_search_v1('QuasarHatch','active','print')->'rows'->0->>'id','a3010000-0000-4000-8000-000000008002','print purpose excludes sites before ranking/caps');
select is(public.command_palette_search_v1('QuasarHatch','active','print')->>'hasMore','false','excluded site matches do not set print hasMore');
select is(public.command_palette_search_v1('PaletteTies','active','move')->>'hasMore','true','move cap counts its own 21st eligible entity');
select is(public.command_palette_search_v1('PaletteTies','active','print')->>'hasMore','true','print cap counts its own 21st eligible entity');
select ok(not exists(select 1 from jsonb_array_elements(public.command_palette_search_v1('PAL-RETIRED','all','move')->'rows') r where r->>'status'<>'active'),'historical scope never advertises historical movement');
select set_config('request.jwt.claims','{"sub":"a3010000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.command_palette_search_v1('pal-zero')->'rows'->0->>'id','a3010000-0000-4000-8000-000000000010','active viewer can search');
select set_config('request.jwt.claims','{"sub":"a3010000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok($$select public.command_palette_search_v1('Palette')$$,'P1001','forbidden','inactive member denied before data');
select set_config('request.jwt.claims','{"sub":"a3010000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select throws_ok($$select public.command_palette_search_v1('Palette')$$,'P1001','forbidden','Auth account without membership denied before data');
reset role;
-- Explain the actual deployed fuzzy arm, including its full row projection.
-- A narrow ID-only probe can change planner width/cost and is not authoritative.
-- Substitute only the fixed active/all/long-query arguments; caller RLS remains.
create function pg_temp.palette_deployed_sql(p_kind text,p_field text,p_query text,p_scope text default 'active',p_purpose text default 'all',p_inner boolean default false)
returns text language plpgsql security invoker as $$
declare table_name text; body text; candidates text; statement text; matches bigint; threshold text; ordering text;
begin
 table_name:=case p_kind when 'asset' then 'serialized_assets' when 'quantity' then 'quantity_items' when 'location' then 'locations' when 'site' then 'sites' end;
 select replace(prosrc,chr(13)||chr(10),chr(10)) into body from pg_catalog.pg_proc where oid='public.command_palette_search_v1(text,text,text)'::regprocedure;
 candidates:=split_part(split_part(body,' with candidates as ('||chr(10),2),chr(10)||' ), best as (',1);
 select count(*),min(btrim(arm)) into matches,statement
 from regexp_split_to_table(candidates,chr(10)||' union all'||chr(10)) arm
 where strpos(arm,'distance,false exact')>0
 and strpos(arm,'  from public.'||table_name||' r where ')>0
 and strpos(arm,'order by public.command_palette_normalize(r.'||p_field||') operator(extensions.<->>) needle fetch first 21 rows with ties')>0;
 if matches<>1 or left(statement,1)<>'(' or right(statement,1)<>')' then
  raise exception 'Expected exactly one deployed fuzzy arm for % %',p_kind,p_field;
 end if;
 statement:=substring(statement from 2 for char_length(statement)-2);
 threshold:='  and public.command_palette_normalize(r.'||p_field||') operator(extensions.%>) needle';
 ordering:='  order by public.command_palette_normalize(r.'||p_field||') operator(extensions.<->>) needle fetch first 21 rows with ties';
 if strpos(statement,threshold||chr(10)||ordering)=0 or strpos(statement,') r where r.term')>0 then
  raise exception 'Threshold must precede the deployed WITH TIES boundary for % %',p_kind,p_field;
 end if;
 if p_inner then
  statement:=split_part(split_part(statement,chr(10)||' from ('||chr(10),2),chr(10)||' ) r',1);
  if statement='' or strpos(statement,ordering)=0 then raise exception 'Missing deployed inner arm'; end if;
 end if;
 return replace(replace(replace(statement,'p_purpose',quote_literal(p_purpose)),'p_scope',quote_literal(p_scope)),'needle',quote_literal(public.command_palette_normalize(p_query)));
end $$;
create function pg_temp.palette_plan(p_kind text,p_field text) returns jsonb language plpgsql security invoker as $$
declare plan jsonb;
begin
 execute 'explain (analyze,buffers,format json) '||pg_temp.palette_deployed_sql(p_kind,p_field,
  case when p_field='name' then 'spectrometer' else 'rivet' end) into plan;
 return plan;
end $$;
select set_config('request.jwt.claims','{"sub":"a3010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local pg_trgm.word_similarity_threshold='0.35';
set local role authenticated;
create temporary table palette_plans as
 select kind,field,pg_temp.palette_plan(kind,field) plan,
 'command_palette_'||kind||'_'||field||'_gist' index_name
 from (values ('asset','name'),('asset','asset_tag'),('asset','serial_number'),('quantity','name'),('quantity','item_code'),('location','name'),('location','code'),('site','name'),('site','code')) fields(kind,field);
select is((select count(*) from palette_plans where jsonb_typeof(plan)='array' and jsonb_array_length(plan)=1),9::bigint,
 'all nine deployed fuzzy-arm plans are present and nonempty');
-- Index choice is recorded separately from deployed cost/semantic evidence.

-- Keep the pre-repair field stream as an independent result-equivalence
-- reference after the forward migration. The production plan assertions above
-- use the deployed threshold-before-WITH-TIES shape; do not derive the reference
-- from the new function body or move its independent threshold/UUID ordering.
-- Reuse the same transaction, JWT, RLS, analyzed 6,000-row fixtures and indexes.
-- Additional owned fixtures cover the inactive-location sibling and sparse
-- qualifying populations without changing the original 6,000-row tie fixture.
reset role;
insert into public.locations(id,code,name,parent_id,kind,can_hold_inventory,active) values
 ('a3010000-0000-4000-8000-000000009998','PAL-KNN-INACTIVE','Palette KNN inactive',
 (select id from public.locations where code='ITC'),'container',true,false);
-- Each field has 1/20/21 matches for independent tokens, against the existing
-- 6,000 unrelated rows. Zero matches uses a fourth absent token. Keep code/tag
-- uniqueness and legal duplicate serials; all fixtures roll back with this test.
insert into public.quantity_items(name,item_code,category_id)
 select token||' '||n,token||'-'||n,(select id from public.categories where code='OTHER')
 from (values ('zygophoton',1),('quavernix',20),('xeldruvak',21)) sparse(token,matches)
 cross join lateral generate_series(1,matches) n;
insert into public.serialized_assets(name,asset_tag,serial_number,category_id,location_id)
 select token||' '||n,token||'-'||n,token||'-'||n,
 (select id from public.categories where code='OTHER'),(select id from public.locations where code='ITC-D01')
 from (values ('zygophoton',1),('quavernix',20),('xeldruvak',21)) sparse(token,matches)
 cross join lateral generate_series(1,matches) n;
insert into public.locations(name,code,parent_id,kind,can_hold_inventory)
 select token||' '||n,upper(token)||'-'||n,(select id from public.locations where code='ITC'),'container',true
 from (values ('zygophoton',1),('quavernix',20),('xeldruvak',21)) sparse(token,matches)
 cross join lateral generate_series(1,matches) n;
insert into public.sites(name,code)
 select token||' '||n,upper(token)||'-'||n
 from (values ('zygophoton',1),('quavernix',20),('xeldruvak',21)) sparse(token,matches)
 cross join lateral generate_series(1,matches) n;
analyze public.serialized_assets;
analyze public.quantity_items;
analyze public.locations;
analyze public.sites;
create function pg_temp.palette_probe_sql(p_kind text,p_field text,p_query text,p_scope text,p_purpose text,p_proposed boolean)
returns text language plpgsql security invoker as $$
declare table_name text; eligibility text; term text; distance text; needle text;
begin
 table_name:=case p_kind when 'asset' then 'serialized_assets' when 'quantity' then 'quantity_items' when 'location' then 'locations' when 'site' then 'sites' end;
 needle:=public.command_palette_normalize(p_query);
 eligibility:=case p_kind
  when 'asset' then format('(%L<>''move'' or r.status=''active'') and (%L=''all'' or r.status=''active'')',p_purpose,p_scope)
  when 'quantity' then format('(%L<>''move'' or not r.archived) and (%L=''all'' or not r.archived)',p_purpose,p_scope)
  when 'location' then format('%L in (''all'',''print'') and (%L=''all'' or r.active)',p_purpose,p_scope)
  when 'site' then format('%L=''all'' and (%L=''all'' or r.active)',p_purpose,p_scope) end;
 term:=format('public.command_palette_normalize(r.%I)',p_field);
 distance:=format('%s operator(extensions.<->>) %L',term,needle);
 if not p_proposed then
  return format('select r.id,%s distance from public.%I r where %s and char_length(%L)>=3 and %s operator(extensions.%%>) %L order by %s,r.id limit 21',distance,table_name,eligibility,needle,term,needle,distance);
 end if;
 -- Distance-only WITH TIES must retain the complete boundary tie before the
 -- outer UUID sort. Putting UUID in this inner order would defeat GiST KNN;
 -- plain LIMIT could discard the true first UUIDs among 6,000 distance ties.
 return format('select nearest.id,nearest.distance from (select r.id,%s term,%s distance from public.%I r where %s and char_length(%L)>=3 and %s operator(extensions.%%>) %L order by %s fetch first 21 rows with ties) nearest order by nearest.distance,nearest.id limit 21',term,distance,table_name,eligibility,needle,term,needle,distance);
end $$;
create function pg_temp.palette_probe_ids(p_sql text) returns jsonb language plpgsql security invoker as $$
declare ids jsonb;
begin
 execute format('select coalesce(jsonb_agg(id order by distance,id),''[]''::jsonb) from (%s) candidates',p_sql) into ids;
 return ids;
end $$;
create function pg_temp.palette_probe_plan(p_sql text) returns jsonb language plpgsql security invoker as $$
declare plan jsonb;
begin
 execute 'explain (analyze,buffers,format json) '||p_sql into plan;
 return plan;
end $$;
create function pg_temp.palette_plan_summary(p_plan jsonb) returns jsonb language sql security invoker as $$
 with recursive nodes(node) as (
  select p_plan->0->'Plan'
  union all
  select child from nodes cross join lateral jsonb_array_elements(coalesce(node->'Plans','[]'::jsonb)) child
 )
 select jsonb_build_object('executionMs',p_plan->0->'Execution Time','nodes',jsonb_agg(
  jsonb_strip_nulls(jsonb_build_object('type',node->'Node Type','index',node->'Index Name',
   'order',node->'Order By','rows',node->'Actual Rows','removed',node->'Rows Removed by Filter',
   'loops',node->'Actual Loops','sharedHit',node->'Shared Hit Blocks','sharedRead',node->'Shared Read Blocks'))))
 from nodes
$$;
create function pg_temp.palette_inner_result(p_sql text,p_query text) returns jsonb language plpgsql security invoker as $$
declare answer jsonb;
begin
 execute format('select jsonb_build_object(''rows'',count(*),''rejected'',count(*) filter (where not coalesce(candidate.term operator(extensions.%%>) %L,false))) from (%s) candidate',public.command_palette_normalize(p_query),p_sql) into answer;
 return answer;
end $$;
set local role authenticated;
select ok(current_user='authenticated' and auth.uid()='a3010000-0000-4000-8000-000000000001'::uuid
 and current_setting('row_security')='on' and current_setting('enable_seqscan')='on',
 'candidate diagnostic retains authenticated JWT, RLS and enabled sequential scans');
select diag('KNN environment: '||jsonb_build_object('server',current_setting('server_version'),
 'pg_trgm',(select extversion from pg_extension where extname='pg_trgm'),
 'extensionSchema',(select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_trgm'),
 'threshold',current_setting('pg_trgm.word_similarity_threshold'),
 'enable_seqscan',current_setting('enable_seqscan'),'enable_indexscan',current_setting('enable_indexscan'),
 'enable_bitmapscan',current_setting('enable_bitmapscan'),'random_page_cost',current_setting('random_page_cost'))::text);
select ok(count(*)=2 and bool_and(not p.proleakproof),'word threshold and distance operators retain their actual nonleakproof catalog flags')
 from pg_operator o join pg_namespace n on n.oid=o.oprnamespace join pg_proc p on p.oid=o.oprcode
 where n.nspname='extensions' and o.oprname in ('%>','<->>') and o.oprleft='text'::regtype and o.oprright='text'::regtype;
select diag('KNN catalog: '||jsonb_build_object('index',p.index_name,'definition',pg_get_indexdef(i.oid),
 'rls',t.relrowsecurity,'forceRls',t.relforcerowsecurity)::text)
 from palette_plans p join pg_class i on i.relname=p.index_name join pg_index ix on ix.indexrelid=i.oid join pg_class t on t.oid=ix.indrelid;

create temporary table palette_probe_fields as
 select p.kind,p.field,p.index_name,
  case when field='name' then 'spectrometer' else 'rivet' end selective,
  case when field='name' then 'calibration' else 'pal-bulk' end common,
  case when field='name' then case kind when 'asset' then 'Palette retired' when 'quantity' then 'Palette archived' when 'location' then 'Palette KNN inactive' else 'Palette inactive site' end
   else case kind when 'asset' then case field when 'asset_tag' then 'PAL-RETIRED' else 'PAL-OLD' end when 'quantity' then 'PAL-ARCHIVED' when 'location' then 'PAL-KNN-INACTIVE' else 'PAL-INACTIVE' end end lifecycle,
  case kind when 'asset' then 'a3010000-0000-4000-8000-000000000022' when 'quantity' then 'a3010000-0000-4000-8000-000000000012' when 'location' then 'a3010000-0000-4000-8000-000000009998' else 'a3010000-0000-4000-8000-000000000031' end lifecycle_id
 from palette_plans p;
-- Exercise the actual deployed full projection and inner boundary, not the
-- synthesized diagnostic candidate. Under sparse/absent search, rejected rows
-- at distance 1 must never inflate WITH TIES output. A scan may still inspect
-- them under nonleakproof caller RLS; record that cost rather than hiding it.
create temporary table palette_sparse_results as
 select f.kind,f.field,s.query,s.expected,
  pg_temp.palette_probe_ids(pg_temp.palette_deployed_sql(f.kind,f.field,s.query)) actual,
  pg_temp.palette_probe_ids(pg_temp.palette_probe_sql(f.kind,f.field,s.query,'active','all',false)) reference,
  pg_temp.palette_inner_result(pg_temp.palette_deployed_sql(f.kind,f.field,s.query,'active','all',true),s.query) inner_result,
  pg_temp.palette_probe_plan(pg_temp.palette_deployed_sql(f.kind,f.field,s.query,'active','all',true)) inner_plan
 from palette_probe_fields f cross join (values
  ('qzxjkvbqzxjkvb',0),('zygophoton',1),('quavernix',20),('xeldruvak',21)) s(query,expected);
select is((select count(*) from palette_sparse_results),36::bigint,'all nine deployed arms include all four absent/sparse cases');
select is(actual,reference,'deployed sparse ordered IDs equal independent reference: '||kind||' '||field||' '||expected)
 from palette_sparse_results order by kind,field,expected;
select is(jsonb_array_length(actual),expected,'deployed arm retains exact sparse candidate count: '||kind||' '||field||' '||expected)
 from palette_sparse_results order by kind,field,expected;
select is((inner_result->>'rows')::integer,expected,'deployed WITH TIES emits qualifying rows only: '||kind||' '||field||' '||expected)
 from palette_sparse_results order by kind,field,expected;
select is((inner_result->>'rejected')::integer,0,'no rejected row enters WITH TIES output: '||kind||' '||field||' '||expected)
 from palette_sparse_results order by kind,field,expected;
select is((inner_plan->0->'Plan'->>'Actual Rows')::integer,expected,'actual boundary plan retains exact sparse cardinality: '||kind||' '||field||' '||expected)
 from palette_sparse_results order by kind,field,expected;
select diag('deployed sparse boundary: '||kind||' '||field||' '||expected||' '||
 pg_temp.palette_plan_summary(inner_plan)::text) from palette_sparse_results order by kind,field,expected;
select is(jsonb_array_length(public.command_palette_search_v1(query)->'rows'),least(expected*4,20),
 'full RPC preserves unique-entity cap for sparse query: '||expected)
 from (values ('qzxjkvbqzxjkvb',0),('zygophoton',1),('quavernix',20),('xeldruvak',21)) s(query,expected);
select is(public.command_palette_search_v1(query)->>'hasMore',(expected*4>20)::text,
 'full RPC preserves overflow sentinel for sparse query: '||expected)
 from (values ('qzxjkvbqzxjkvb',0),('zygophoton',1),('quavernix',20),('xeldruvak',21)) s(query,expected);
create temporary table palette_probe_cases as
 select f.*,s.scenario,s.scope,s.purpose,
  case s.scenario when 'common' then common when 'unicode' then chr(160)||selective||chr(65279)
   when 'absent' then 'qzxjkvbqzxjkvb' when 'lifecycle-active' then lifecycle when 'lifecycle-all' then lifecycle
   when 'lifecycle-move' then lifecycle when 'lifecycle-print' then lifecycle else selective end query
 from palette_probe_fields f cross join (values
  ('selective','active','all'),('common','active','all'),('unicode','active','all'),('absent','active','all'),
  ('lifecycle-active','active','all'),('lifecycle-all','all','all'),('lifecycle-move','all','move'),('lifecycle-print','all','print'),
  ('purpose-move','active','move'),('purpose-print','active','print')) s(scenario,scope,purpose);
create temporary table palette_probe_results as
 select c.*,
  pg_temp.palette_probe_ids(pg_temp.palette_probe_sql(kind,field,query,scope,purpose,false)) original,
  pg_temp.palette_probe_ids(pg_temp.palette_probe_sql(kind,field,query,scope,purpose,true)) proposed
 from palette_probe_cases c;
select is(proposed,original,'candidate ordered IDs equal original: '||kind||' '||field||' '||scenario)
 from palette_probe_results order by kind,field,scenario;
select is(jsonb_array_length(proposed),21,'candidate retains all 21 available sentinels: '||kind||' '||field||' '||scenario)
 from palette_probe_results where scenario in ('selective','common') order by kind,field,scenario;
select ok(proposed ? lifecycle_id,'candidate all scope retains known lifecycle row: '||kind||' '||field)
 from palette_probe_results where scenario='lifecycle-all' order by kind,field;
select ok(not (proposed ? lifecycle_id),'candidate excludes known lifecycle row before limit: '||kind||' '||field||' '||scenario)
 from palette_probe_results where scenario in ('lifecycle-active','lifecycle-move') order by kind,field,scenario;
select is(proposed,'[]'::jsonb,'candidate excludes ineligible kind before limit: '||kind||' '||field||' '||scenario)
 from palette_probe_results where (scenario='purpose-move' and kind in ('location','site')) or (scenario='purpose-print' and kind='site') order by kind,field,scenario;


-- Keep the existing fixture, authorization, normalization and semantic tests.
-- Cost proof always explains the exact full deployed arm, never an ID-only proxy.
create function pg_temp.cost_plan(p_sql text) returns jsonb language plpgsql security invoker as $$
declare answer jsonb;
begin
 execute 'explain (analyze,buffers,format json) '||p_sql into answer;
 return answer;
end $$;
-- Iterate the actual portal stream. Never sort deployed rows in the observer.
-- The same session observes text anti-sort fixtures and native deployed UUIDs.
-- A static candidate.id expression caches the first record-field type, even if
-- cast afterward. Convert the whole anonymous record to fixed jsonb first.
create function pg_temp.cost_emitted_ids(p_sql text) returns jsonb language plpgsql security invoker as $$
declare candidate record; answer jsonb:='[]'::jsonb;
begin
 for candidate in execute p_sql loop
  answer:=answer||jsonb_build_array(to_jsonb(candidate)->'id');
 end loop;
 return answer;
end $$;
select is(pg_temp.cost_emitted_ids('select id from (values (1,''second''),(2,''first'')) emitted(position,id) order by position'),
 '["second","first"]'::jsonb,'emitted-order observer preserves deliberately nonalphabetical stream');
-- Change both the id type and anonymous row descriptor in this same backend;
-- the deployed query remains untouched, and JSON numbers/null must not be text.
select is(pg_temp.cost_emitted_ids($stream$
 select 'uuid fixture' description,id from (values
 (1,'a3010000-0000-4000-8000-000000000009'::uuid),
 (2,'a3010000-0000-4000-8000-000000000001'::uuid)) emitted(position,id) order by position
$stream$),'["a3010000-0000-4000-8000-000000000009","a3010000-0000-4000-8000-000000000001"]'::jsonb,
 'emitted-order observer accepts UUID IDs and a changed descriptor after text without sorting');
select is(pg_temp.cost_emitted_ids('select id from (values (1,''tail''),(2,''head'')) emitted(position,id) order by position'),
 '["tail","head"]'::jsonb,'emitted-order observer returns to text after UUID in the same backend');
select is(pg_temp.cost_emitted_ids('select id from (values (1,2),(2,1)) emitted(position,id) order by position'),
 '[2,1]'::jsonb,'emitted-order observer preserves native numeric JSON IDs instead of casting to text');
select is(pg_temp.cost_emitted_ids('select null::uuid id'),
 '[null]'::jsonb,'emitted-order observer preserves native null after changing ID types');
create function pg_temp.cost_nodes(p_plan jsonb) returns setof jsonb language sql security invoker as $$
 with recursive nodes(node) as (
  select p_plan->0->'Plan' union all
  select child from nodes cross join lateral jsonb_array_elements(coalesce(node->'Plans','[]'::jsonb)) child
 ) select node from nodes
$$;
create function pg_temp.cost_summary(p_plan jsonb) returns jsonb language sql security invoker as $$
 select jsonb_build_object('executionMs',p_plan->0->'Execution Time',
  'rootBuffers',coalesce((p_plan->0->'Plan'->>'Shared Hit Blocks')::bigint,0)+coalesce((p_plan->0->'Plan'->>'Shared Read Blocks')::bigint,0),
  'nodes',(select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'type',n->'Node Type','relation',n->'Relation Name','index',n->'Index Name',
   'startupCost',n->'Startup Cost','totalCost',n->'Total Cost','estimatedRows',n->'Plan Rows','width',n->'Plan Width',
   'actualRows',n->'Actual Rows','loops',n->'Actual Loops','removed',n->'Rows Removed by Filter',
   'sharedHit',n->'Shared Hit Blocks','sharedRead',n->'Shared Read Blocks',
   'tempRead',n->'Temp Read Blocks','tempWritten',n->'Temp Written Blocks',
   'sortMethod',n->'Sort Method','sortSpaceType',n->'Sort Space Type',
   'indexCond',n->'Index Cond','filter',n->'Filter','order',n->'Order By','sortKey',n->'Sort Key')))
   from pg_temp.cost_nodes(p_plan) n))
$$;
select ok(current_user='authenticated' and auth.uid()='a3010000-0000-4000-8000-000000000001'::uuid
 and current_setting('row_security')='on' and current_setting('enable_seqscan')='on'
 and current_setting('enable_indexscan')='on' and current_setting('enable_bitmapscan')='on'
 and current_setting('random_page_cost')='4' and current_setting('pg_trgm.word_similarity_threshold')='0.35',
 'cost experiment retains default planner, authenticated actor and caller RLS');
create temporary table cost_cases as
 select f.kind,f.field,f.index_name,s.scenario,
 case s.scenario when 'selective' then f.selective when 'common' then f.common
 else s.query end query
 from palette_probe_fields f cross join (values
 ('selective',null::text),('common',null::text),('absent','qzxjkvbqzxjkvb'),
 ('sparse1','zygophoton'),('sparse20','quavernix'),('sparse21','xeldruvak')) s(scenario,query);
create temporary table cost_results as
 select c.*,pg_temp.cost_plan(pg_temp.palette_deployed_sql(kind,field,query)) plan,
 pg_temp.cost_emitted_ids(pg_temp.palette_deployed_sql(kind,field,query)) actual,
 pg_temp.palette_probe_ids(pg_temp.palette_probe_sql(kind,field,query,'active','all',false)) reference
 from cost_cases c;
select is(count(*),54::bigint,'all nine exact full-projection arms cover all six workloads') from cost_results;
select ok((plan->0->>'Execution Time')::numeric<=500,
 'deployed arm <=500ms: '||kind||' '||field||' '||scenario) from cost_results;
 select ok((plan->0->'Plan') ?& array['Shared Hit Blocks','Shared Read Blocks']
 and (plan->0->'Plan'->>'Shared Hit Blocks')::bigint+(plan->0->'Plan'->>'Shared Read Blocks')::bigint<=16384,
 'deployed root shared buffers <=16384: '||kind||' '||field||' '||scenario) from cost_results;
select ok(not exists(select 1 from pg_temp.cost_nodes(plan) n
 where coalesce((n->>'Temp Read Blocks')::bigint,0)>0 or coalesce((n->>'Temp Written Blocks')::bigint,0)>0
 or n->>'Sort Space Type'='Disk' or n->>'Sort Method' like '%external%'),
 'deployed arm does not spill: '||kind||' '||field||' '||scenario) from cost_results;
-- IDs and distance/UUID order remain an independent semantic oracle.
select is(actual,reference,'deployed ordered IDs equal independent reference: '||kind||' '||field||' '||scenario) from cost_results;
select ok(jsonb_array_length(actual)<=21,'deployed output <=21: '||kind||' '||field||' '||scenario) from cost_results;
select diag('deployed-cost '||kind||' '||field||' '||scenario||' '||pg_temp.cost_summary(plan)::text) from cost_results order by kind,field,scenario;

-- Independent capability proof only. Change just the inner WITH TIES count.
-- This is never labeled deployed performance proof; a missing index is a failure.
create function pg_temp.eligibility_sql(p_kind text,p_field text,p_query text) returns text language plpgsql security invoker as $$
declare deployed text;
begin
 deployed:=pg_temp.palette_deployed_sql(p_kind,p_field,p_query);
 if (length(deployed)-length(replace(deployed,'fetch first 21 rows with ties','')))/length('fetch first 21 rows with ties')<>1 then
  raise exception 'Expected exactly one unchanged deployed WITH TIES boundary';
 end if;
 return replace(deployed,'fetch first 21 rows with ties','fetch first 1 rows with ties');
end $$;
create temporary table cost_eligibility as
 select kind,field,index_name,pg_temp.cost_plan(pg_temp.eligibility_sql(kind,field,selective)) plan from palette_probe_fields;
select is(count(*),9::bigint,'all nine independent index eligibility plans exist') from cost_eligibility;
select ok(jsonb_path_exists(plan,'$[0].Plan.** ? (@."Index Name" == $index && exists(@."Order By"))',jsonb_build_object('index',index_name)),
 'independent LIMIT1 WITH TIES index eligibility: '||kind||' '||field) from cost_eligibility;
select diag('independent-eligibility '||kind||' '||field||' '||pg_temp.cost_summary(plan)::text) from cost_eligibility order by kind,field;

-- Whole RPC success is separate from each arm budget and overdue Data API proof.
create temporary table cost_rpc as
 select query,pg_temp.cost_plan(format('select public.command_palette_search_v1(%L,''active'',''all'')',query)) plan
 from (values ('spectrometer'),('rivet'),('calibration'),('pal-bulk'),('qzxjkvbqzxjkvb'),('quavernix')) q(query);
select ok((plan->0->>'Execution Time')::numeric<5000,'whole authenticated RPC succeeds before5s: '||query) from cost_rpc;
select diag('whole-rpc '||query||' '||pg_temp.cost_summary(plan)::text) from cost_rpc;
select diag('planner-setting '||name||'='||setting) from pg_settings
 where name in ('server_version','row_security','enable_seqscan','enable_indexscan','enable_bitmapscan',
 'random_page_cost','seq_page_cost','cpu_tuple_cost','cpu_index_tuple_cost','cpu_operator_cost',
 'effective_cache_size','work_mem','pg_trgm.word_similarity_threshold');
select diag('relation-stat '||jsonb_build_object('relation',c.relname,'pages',c.relpages,'tuples',c.reltuples,
 'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity)::text)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname in ('serialized_assets','quantity_items','locations','sites');
select diag('field-stat '||jsonb_build_object('relation',tablename,'field',attname,'nullFraction',null_frac,
 'averageWidth',avg_width,'distinct',n_distinct,'correlation',correlation)::text)
 from pg_stats where schemaname='public' and (tablename,attname) in
 (('serialized_assets','name'),('serialized_assets','asset_tag'),('serialized_assets','serial_number'),
 ('quantity_items','name'),('quantity_items','item_code'),('locations','name'),('locations','code'),('sites','name'),('sites','code'));

select * from finish();
rollback;
