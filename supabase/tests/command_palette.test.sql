begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','command_palette_search_v1',array['text','text','text']);
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.inventory_locations'::regclass),'canonical breadcrumb view retains caller RLS');

select ok(not has_function_privilege(role_name,'public.command_palette_search_v1(text,text,text)','EXECUTE'),role_name||' cannot search')
 from (values ('anon'),('service_role')) roles(role_name);
select ok(has_function_privilege('authenticated','public.command_palette_search_v1(text,text,text)','EXECUTE'),'caller role can reach membership guard');
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
-- Plan evidence helper runs the same expression, eligibility and distance
-- orientation as the field stream, with caller RLS active at execution.
create function pg_temp.palette_plan(p_kind text,p_field text) returns jsonb language plpgsql security invoker as $$
declare plan jsonb; table_name text; eligibility text; query text;
begin
 table_name:=case p_kind when 'asset' then 'serialized_assets' when 'quantity' then 'quantity_items' when 'location' then 'locations' when 'site' then 'sites' end;
 eligibility:=case p_kind when 'asset' then 'r.status=''active''' when 'quantity' then 'not r.archived' else 'r.active' end;
 query:=case when p_field='name' then 'spectrometer' else 'rivet' end;
 execute format('explain (analyze,buffers,format json) select r.id from public.%I r where %s and public.command_palette_normalize(r.%I) operator(extensions.%%>) %L order by public.command_palette_normalize(r.%I) operator(extensions.<->>) %L,r.id limit 21',table_name,eligibility,p_field,query,p_field,query) into plan;
 return plan;
end $$;
select set_config('request.jwt.claims','{"sub":"a3010000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local pg_trgm.word_similarity_threshold='0.35';
set local role authenticated;
create temporary table palette_plans as
 select kind,field,pg_temp.palette_plan(kind,field) plan,
 'command_palette_'||kind||'_'||field||'_gist' index_name
 from (values ('asset','name'),('asset','asset_tag'),('asset','serial_number'),('quantity','name'),('quantity','item_code'),('location','name'),('location','code'),('site','name'),('site','code')) fields(kind,field);
select ok(jsonb_path_exists(plan,
 '$[0].Plan.** ? (@."Index Name" == $index && exists(@."Order By"))',
 jsonb_build_object('index',index_name)),
 'real authenticated large-fixture KNN plan uses '||kind||' '||field)
 from palette_plans;
select diag(kind||' '||field||' failed KNN plan: '||jsonb_pretty(plan)) from palette_plans
 where not jsonb_path_exists(plan,'$[0].Plan.** ? (@."Index Name" == $index && exists(@."Order By"))',jsonb_build_object('index',index_name));
select * from finish();
rollback;
