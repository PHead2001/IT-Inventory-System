begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select is(to_regprocedure('public.inventory_view_matches(text,text,text,uuid,text,uuid,boolean)'),null::regprocedure,'unbounded matching helper is absent from the public API schema');
select is((select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in
 ('inventory_view_matches','inventory_grouped_page','metadata_inventory_columns','metadata_selected_preview')),3::bigint,'only the three bounded new inventory-view RPCs are public');
select ok(not prosecdef and proconfig @> array['statement_timeout=5s']
 and exists(select 1 from unnest(proconfig) setting where setting in ('search_path=""','search_path=')),'private matcher remains invoker with an empty search path and deadline')
from pg_proc where oid='private.inventory_view_matches(text,text,text,uuid,text,uuid,boolean)'::regprocedure;
select ok(not has_function_privilege(role_name,'private.inventory_view_matches(text,text,text,uuid,text,uuid,boolean)','EXECUTE'),role_name||' cannot invoke private matcher')
from (values('anon'),('service_role')) roles(role_name);
select ok(has_function_privilege('authenticated','private.inventory_view_matches(text,text,text,uuid,text,uuid,boolean)','EXECUTE'),'authenticated invoker can call the private implementation helper');
select ok(not exists(select 1 from pg_proc p,aclexplode(p.proacl) a where p.oid='private.inventory_view_matches(text,text,text,uuid,text,uuid,boolean)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),'PUBLIC has no matcher execution grant');
-- Exact representation accounting has an independent JSONB serialization oracle:
-- escaped/multibyte labels, prior groups, separators, metadata and count digits.
with cases as (
 select previous_count,holding_rows,
  jsonb_build_object('row',jsonb_build_object('name',E'Quoted " name\n😀'),
   'holdings','[]'::jsonb,'scoped_storage','9007199254740993','scoped_site','0','holding_count',12) as header,
  jsonb_build_array(jsonb_build_object('name',E'first\n😀'),jsonb_build_object('name','second')) as holdings,
  case when previous_count=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('metadata','prior group')) end as prior
 from (values(0,9),(0,10),(1,99),(1,100)) v(previous_count,holding_rows)
), accounting as (
 select *,octet_length(jsonb_build_object('rows','[]'::jsonb,'total',26,'holding_rows',holding_rows)::text)-2
  +octet_length(prior::text)+octet_length(header::text)-2+octet_length(holdings::text)
  +case when previous_count>0 then 2 else 0 end as computed,
  octet_length(jsonb_build_object('rows',prior||jsonb_build_array(header||jsonb_build_object('holdings',holdings)),
   'total',26,'holding_rows',holding_rows)::text) as actual from cases
)
select is(computed,actual,'complete JSONB bytes match independent serialization with prior groups='||previous_count||' rows='||holding_rows)
from accounting;
select ok(not p.prosecdef and p.proconfig @> array['statement_timeout=5s'],'caller RLS and hoistable timeout: '||p.proname)
from pg_proc p where p.oid in (
 'public.inventory_grouped_page(text,text,text,uuid,text,uuid,integer,boolean)'::regprocedure,
 'public.metadata_inventory_columns(text,uuid[])'::regprocedure,
 'public.metadata_selected_preview(jsonb,uuid[])'::regprocedure);
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),role_name||' denied '||signature)
from (values('anon'),('service_role')) roles(role_name) cross join (values
 ('public.inventory_grouped_page(text,text,text,uuid,text,uuid,integer,boolean)'),
 ('public.metadata_inventory_columns(text,uuid[])'),('public.metadata_selected_preview(jsonb,uuid[])')) functions(signature);
create temporary table view_actors(kind text primary key,id uuid default gen_random_uuid());
insert into view_actors(kind) values('viewer'),('staff'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,'views-'||kind||'@sql.example.test' from view_actors;
insert into public.app_members(user_id,display_name,role,active)
select id,'View '||kind,case when kind='viewer' then 'viewer' else 'staff' end,kind<>'inactive' from view_actors where kind<>'nonmember';
create temporary table view_items(n integer primary key,id uuid default gen_random_uuid());
insert into view_items(n) select generate_series(1,27);
insert into public.quantity_items(id,name,category_id,archived,reorder_threshold)
select id,'VIEW-SQL %_ '||lpad(n::text,2,'0'),(select id from public.categories where code='CABLES'),n=27,
 case when n=1 then 12 else null end from view_items;
insert into public.stock_balances(item_id,location_id,quantity)
select id,(select id from public.locations where code='ITC-S1A'),4 from view_items where n=1;
insert into public.stock_balances(item_id,location_id,quantity)
select id,(select id from public.locations where code='ITC-S1B'),6 from view_items where n=1;
insert into public.sites(code,name) values('VIEW-SQL-SITE','View SQL site');
insert into public.site_quantity_holdings(item_id,site_id,quantity)
select id,(select id from public.sites where code='VIEW-SQL-SITE'),3 from view_items where n=1;
insert into public.serialized_assets(name,category_id,location_id,status)
 select 'VIEW-RETIRED-ASSET',c.id,l.id,'retired' from public.categories c cross join public.locations l
 where c.code='CABLES' and l.code='ITC-S1A';
select set_config('request.jwt.claims',json_build_object('sub',(select id from view_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
set local statement_timeout='5s';
select is(public.inventory_grouped_page(p_query=>'VIEW-RETIRED-ASSET',p_type=>'asset',p_status=>'historical')->'rows'->0->'row'->>'status','retired','retired identity is retained without claiming active stock');
select is(public.inventory_grouped_page(p_query=>'VIEW-RETIRED-ASSET',p_status=>'historical')->'rows'->0->'holdings'->0->>'location_id',(select id::text from public.locations where code='ITC-S1A'),'retired asset keeps its last recorded logical storage');
-- Direct SQL establishes the timer before inventory reads; REST hoisting is tested separately.
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL %_')->>'total')::integer,26,'group count is distinct identities, not 28 holding rows');
select is(jsonb_array_length(public.inventory_grouped_page(p_query=>'VIEW-SQL %_')->'rows'),25,'pagination happens after grouping');
select is(jsonb_array_length(public.inventory_grouped_page(p_query=>'VIEW-SQL %_',p_page=>2)->'rows'),1,'second page retains the 26th distinct identity');
select is(jsonb_array_length(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 01')->'rows'->0->'holdings'),3,'expansion includes both storage holdings and the site');
select is(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 01')->'rows'->0->>'scoped_storage','10','scoped storage totals are decimal strings');
select is(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 01')->'rows'->0->>'scoped_site','3','scoped site totals are separate');
select is(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 01',p_location_code=>'ITC-S1')->'rows'->0->>'scoped_storage','10','subtree filter expands both matching leaves');
select is(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 01',p_location_code=>'ITC-S1A')->'rows'->0->>'scoped_storage','4','leaf scope excludes other holdings');
select is(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 01',p_location_code=>'ITC-S1A')->'rows'->0->'row'->>'recorded_quantity','13','overall totals remain independent of scoped leaf totals');
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL %_',p_low_stock=>true)->>'total')::integer,1,'low-stock uses overall available storage threshold');
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL %_',p_type=>'asset')->>'total')::integer,0,'tracking type is applied before grouping');
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL %_',p_status=>'historical')->>'total')::integer,1,'historical lifecycle scope is retained');
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL %_',p_status=>'all')->>'total')::integer,27,'all statuses include archived zero definitions');
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL XY')->>'total')::integer,0,'percent and underscore search are literal, not wildcards');
select is(public.inventory_grouped_page(p_query=>'VIEW-SQL %_ 02')->'rows'->0->>'holding_count','0','zero definition never invents a holding');
select throws_ok($$select public.inventory_grouped_page(p_query=>repeat('x',201))$$,'P1012','invalid_inventory_view','direct caller cannot exceed query length');
select throws_ok($$select public.metadata_selected_preview('[]','{00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000001}')$$,'P1012','invalid_column_request','duplicate selected field identities are rejected');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from view_actors where kind='staff'),'role','authenticated')::text,true);
set local role authenticated;
select is((public.inventory_grouped_page(p_query=>'VIEW-SQL %_')->>'total')::integer,26,'active staff reads the same authorized page');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from view_actors where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_grouped_page()$$,'P1001','forbidden','inactive viewer cannot read groups');
select throws_ok($$select public.metadata_inventory_columns()$$,'P1001','forbidden','inactive member cannot read catalog labels');
select throws_ok($$select public.metadata_selected_preview('[]','{}')$$,'P1001','forbidden','inactive member cannot read selected previews');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from view_actors where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_grouped_page()$$,'P1001','forbidden','Auth alone does not grant grouped reads');
select throws_ok($$select public.metadata_inventory_columns()$$,'P1001','forbidden','nonmember cannot read catalog labels');
reset role;

-- Bounds fail before JSON aggregation and never return a truncated group.
insert into public.quantity_items(name,category_id) select 'VIEW-OVERFLOW',(select id from public.categories where code='CABLES');
insert into public.sites(code,name) select 'VIEW-CAP-'||n,'View cap '||n from generate_series(1,1001) n;
insert into public.site_quantity_holdings(item_id,site_id,quantity)
select q.id,s.id,1 from public.quantity_items q cross join public.sites s where q.name='VIEW-OVERFLOW' and s.code like 'VIEW-CAP-%';
select set_config('request.jwt.claims',json_build_object('sub',(select id from view_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_grouped_page(p_query=>'VIEW-OVERFLOW')$$,'P1025','inventory_group_holdings_limit','one 1001-holding item fails rather than truncating its totals');
reset role;
insert into public.categories(code,name) values('VIEW-BYTES',repeat('😀',200));
insert into public.quantity_items(name,category_id) select repeat('😁',200),id from public.categories where code='VIEW-BYTES';
insert into public.sites(code,name) select 'VIEW-BYTE-'||n,repeat('😃',190)||n from generate_series(1,1000) n;
insert into public.site_quantity_holdings(item_id,site_id,quantity)
select q.id,s.id,1 from public.quantity_items q join public.categories c on c.id=q.category_id cross join public.sites s where c.code='VIEW-BYTES' and s.code like 'VIEW-BYTE-%';
create temporary table view_byte_category as select id from public.categories where code='VIEW-BYTES';
grant select on view_byte_category to authenticated;
set local role authenticated;
select throws_ok($$select public.inventory_grouped_page(p_category_id=>(select id from view_byte_category))$$,'P1025','inventory_group_byte_limit','legal row count with large Unicode labels fails complete UTF8 byte limit');
reset role;
-- Selected columns resolve UUIDs against recorded published revisions. False and
-- zero are answers, and removing a field from the current form keeps its answer.
create temporary table view_metadata_fixture(category uuid,record_id uuid,bool_field uuid,count_field uuid,asset_field uuid,empty_record uuid);
do $$
declare c uuid:=gen_random_uuid(); rev uuid:=gen_random_uuid(); later uuid:=gen_random_uuid();
 b uuid:=gen_random_uuid(); n uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); empty_item uuid:=gen_random_uuid(); definition jsonb;
begin
 insert into public.categories(id,code,name) values(c,'VIEW-FIELDS',repeat(chr(128512),101));
 select private.metadata_effective_definition(id,draft_definition) into definition
  from public.category_form_revisions where category_id is null and status='published';
 definition:=jsonb_set(definition,'{fields}',jsonb_build_array(
  jsonb_build_object('id',b,'type','boolean','label','Enabled','applies_to',jsonb_build_array('quantity'),'required',false,'rules','{}'::jsonb,'options','[]'::jsonb),
  jsonb_build_object('id',n,'type','integer','label',repeat(chr(128513),101),'applies_to',jsonb_build_array('quantity'),'required',false,'rules','{}'::jsonb,'options','[]'::jsonb),
  jsonb_build_object('id',a,'type','boolean','label','Asset only','applies_to',jsonb_build_array('asset'),'required',false,'rules','{}'::jsonb,'options','[]'::jsonb)));
 insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition) values(rev,c,'draft',2,definition);
 perform private.metadata_compile_form(rev,c,definition);
 update public.category_form_revisions set status='published',published_at=now() where id=rev;
 update public.categories set published_form_revision_id=rev where id=c;
 insert into public.quantity_items(id,name,category_id,custom_values) values(item,'VIEW-FIELD-ANSWERS',c,
  jsonb_build_object(b::text,jsonb_build_object('value',false,'validated_revision_id',rev),n::text,jsonb_build_object('value',0,'validated_revision_id',rev)));
 insert into public.quantity_items(id,name,category_id) values(empty_item,'VIEW-FIELD-UNANSWERED',c);
 definition:=jsonb_set(definition,'{fields}',jsonb_build_array(definition->'fields'->1,definition->'fields'->2));
 insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition) values(later,c,'draft',3,definition);
 perform private.metadata_compile_form(later,c,definition);
 update public.category_form_revisions set status='published',published_at=now() where id=later;
 update public.categories set published_form_revision_id=later where id=c;
 insert into view_metadata_fixture values(c,item,b,n,a,empty_item);
end; $$;
grant select on view_metadata_fixture to authenticated;
set local role authenticated;
select is((public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',record_id)),array[bool_field,count_field])->('quantity:'||record_id)->'answers'->0->>'displayValue'),'No','false is a stable recorded answer') from view_metadata_fixture;
select is((public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',record_id)),array[bool_field,count_field])->('quantity:'||record_id)->'answers'->1->>'displayValue'),'0','zero is a stable recorded answer') from view_metadata_fixture;
select is((public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',record_id)),array[bool_field,count_field])->('quantity:'||record_id)->'answers'->0->>'legacy'),'true','removed fields retain historical answer provenance') from view_metadata_fixture;
select is((public.metadata_inventory_columns('No matching label',array[bool_field])->'fields'->0->>'id'),bool_field::text,'selected historical field resolves outside the searched result page') from view_metadata_fixture;
select is((public.metadata_inventory_columns('No matching label',array[bool_field])->'fields'->0->>'legacy'),'true','catalog identifies its historical published label') from view_metadata_fixture;
select is((public.metadata_inventory_columns('VIEW-FIELD%')->'fields')::text,'[]','field search is literal rather than LIKE wildcard matching');
select is(length(public.metadata_inventory_columns('No matching label',array[count_field])->'fields'->0->>'label'),101,'selected catalog Unicode labels use code points, not UTF16 units') from view_metadata_fixture;
select is(length(public.metadata_inventory_columns('No matching label',array[count_field])->'fields'->0->>'category'),101,'selected category Unicode labels resolve outside the search cap') from view_metadata_fixture;
select is(public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',empty_record)),array[count_field])->('quantity:'||empty_record)->'answers'->0->>'absence','unanswered','current applicable missing answer is unanswered') from view_metadata_fixture;
select is(public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',empty_record)),array[asset_field])->('quantity:'||empty_record)->'answers'->0->>'absence','not_applicable','current asset-only field is inapplicable to quantity') from view_metadata_fixture;
select is(public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',empty_record)),array[bool_field])->('quantity:'||empty_record)->'answers'->0->>'absence','historical_unavailable','removed field without an answer has no current definition') from view_metadata_fixture;
select is(public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',empty_record)),array[bool_field])->('quantity:'||empty_record)->'answers'->0->>'label','Enabled','missing historical answer preserves its published human label') from view_metadata_fixture;
select is(public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',empty_record)),array[bool_field])->('quantity:'||empty_record)->'answers'->0->>'legacy','true','missing historical answer marks label provenance') from view_metadata_fixture;
select is(public.metadata_selected_preview(jsonb_build_array(jsonb_build_object('kind','quantity','id',empty_record)),array['00000000-0000-4000-8000-000000000001'::uuid])->('quantity:'||empty_record)->'answers'->0->>'absence','field_unavailable','unrelated field has no invented category definition') from view_metadata_fixture;

reset role;
select * from finish();
rollback;
