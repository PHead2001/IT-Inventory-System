begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_function('public', 'inventory_location_occupancy', array['text[]']);
select ok(not prosecdef and provolatile='s', 'occupancy is stable and uses caller RLS') from pg_proc where oid='public.inventory_location_occupancy(text[])'::regprocedure;
select ok(exists(select 1 from unnest(proconfig) setting where setting in ('search_path=""','search_path=')), 'empty search path') from pg_proc where oid='public.inventory_location_occupancy(text[])'::regprocedure;
select ok(exists(select 1 from unnest(proconfig) setting where setting='statement_timeout=5s'), 'bounded statement timeout') from pg_proc where oid='public.inventory_location_occupancy(text[])'::regprocedure;
select ok(not has_function_privilege(role_name,'public.inventory_location_occupancy(text[])','EXECUTE'),role_name || ' cannot invoke occupancy') from (values('anon'),('service_role')) roles(role_name);
select ok(has_function_privilege('authenticated','public.inventory_location_occupancy(text[])','EXECUTE'),'authenticated can request caller-scoped occupancy');
select has_function('public','inventory_location_entry_counts',array['text[]'],'legacy entry count contract remains available');

create temporary table occupancy_actors(kind text primary key,id uuid not null default gen_random_uuid());
insert into occupancy_actors(kind) values('staff'),('viewer'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,'occupancy-' || kind || '@sql.example.test' from occupancy_actors;
insert into public.app_members(user_id,display_name,role,active,can_manage_configuration)
select id,'Occupancy ' || kind,case when kind='viewer' then 'viewer' else 'staff' end,kind <> 'inactive',kind='staff' from occupancy_actors where kind <> 'nonmember';
select set_config('request.jwt.claims',json_build_object('sub',(select id from occupancy_actors where kind='staff'),'role','authenticated')::text,true);
-- Owned disposable locations isolate the aggregate from other test fixtures.
create temporary table occupancy_locations as
with inserted as (
  insert into public.locations(code,name,parent_id,kind,can_hold_inventory,active,sort_order)
  select code,code,(select id from public.locations where code='ITO'),'storage_area',true,true,99
  from (values('ITO-OCC-STOCK'),('ITO-OCC-ZERO')) codes(code) returning id,code
) select * from inserted;
create temporary table occupancy_items as
select (public.quantity_create(gen_random_uuid(),jsonb_build_object('name','Occupancy product A','category_id',(select id from public.categories where code='CABLES'),'initial_quantity',31,'initial_location_id',(select id from occupancy_locations where code='ITO-OCC-STOCK')))->>'entity_id')::uuid id;
insert into occupancy_items
select (public.quantity_create(gen_random_uuid(),jsonb_build_object('name','Occupancy product B','category_id',(select id from public.categories where code='CABLES'),'initial_quantity',7,'initial_location_id',(select id from occupancy_locations where code='ITO-OCC-STOCK')))->>'entity_id')::uuid;
create temporary table occupancy_assets as
select (public.asset_create(gen_random_uuid(),jsonb_build_object('name','Occupancy active asset ' || i,'category_id',(select id from public.categories where code='COMPUTERS'),'location_id',(select id from occupancy_locations where code='ITO-OCC-STOCK')))->>'entity_id')::uuid id,i from generate_series(1,4) i;
select public.asset_retire(gen_random_uuid(),jsonb_build_object('asset_id',(select id from occupancy_assets where i=3),'expected_version',1,'reason','Occupancy retired fixture'));
create temporary table occupancy_site as select (public.site_create(gen_random_uuid(),'{"code":"OCC-SITE","name":"Occupancy assigned site"}'::jsonb)->>'entity_id')::uuid id;
select public.asset_site_change(gen_random_uuid(),jsonb_build_object('action','assign','asset_id',(select id from occupancy_assets where i=4),'expected_version',1,'source_location_id',(select id from occupancy_locations where code='ITO-OCC-STOCK'),'destination_site_id',(select id from occupancy_site)));

set local role authenticated;
select is((select quantity_product_count from public.inventory_location_occupancy(array['ITO-OCC-STOCK'])),'2','distinct positive-stock products');
select is((select quantity_unit_count from public.inventory_location_occupancy(array['ITO-OCC-STOCK'])),'38','units are summed once, not multiplied by assets');
select is((select asset_count from public.inventory_location_occupancy(array['ITO-OCC-STOCK'])),'2','only active physically stored assets, excluding retired and site-assigned');
select is((select quantity_product_count || ':' || quantity_unit_count || ':' || asset_count from public.inventory_location_occupancy(array['ITO-OCC-ZERO'])),'0:0:0','known eligible zero is explicit');
select is((select count(*)::integer from public.inventory_location_occupancy(array['ITO','UNKNOWN'])) ,0,'parent and missing codes stay unknown');
select is((select entry_count from public.inventory_location_entry_counts(array['ITO-OCC-STOCK'])),'4','legacy active-entry semantics remain unchanged');
select throws_ok($$select public.inventory_location_occupancy(array['X','X'])$$,'P1012','invalid_location_count_request','duplicate codes rejected');
select throws_ok($$select public.inventory_location_occupancy(null)$$,'P1012','invalid_location_count_request','null scope rejected');
select throws_ok($$select public.inventory_location_occupancy(array[null::text])$$,'P1012','invalid_location_count_request','null code rejected');
select throws_ok($$select public.inventory_location_occupancy(array(select 'L' || i from generate_series(1,101) i))$$,'P1012','invalid_location_count_request','scope over 100 rejected');
select throws_ok($$select public.inventory_location_occupancy(array(select i || repeat('界',97) from generate_series(1,100) i))$$,'P1012','invalid_location_count_request','UTF-8 payload over 16 KiB rejected');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from occupancy_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is((select quantity_unit_count from public.inventory_location_occupancy(array['ITO-OCC-STOCK'])),'38','active viewer can read occupancy');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from occupancy_actors where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_location_occupancy(array['ITO-OCC-STOCK'])$$,'P1001','forbidden','inactive member denied before aggregation');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from occupancy_actors where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_location_occupancy(array['ITO-OCC-STOCK'])$$,'P1001','forbidden','authenticated nonmember denied');
reset role;
select * from finish();
rollback;