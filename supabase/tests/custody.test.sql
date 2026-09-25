begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select is((select count(*)::integer from public.locations where code in ('ITO','ITO-GENERAL')),
 2,'the unmodeled office and provisional storage are seeded');
select is((select kind from public.locations where code='ITO-GENERAL'),'storage_area',
 'office provisional destination uses the general storage kind');
select ok((select can_hold_inventory from public.locations where code='ITO-GENERAL'),
 'office provisional area holds inventory');

create temporary table custody_actors(kind text primary key,id uuid not null default gen_random_uuid());
insert into custody_actors(kind) values('maintainer'),('staff'),('viewer'),('inactive');
insert into auth.users(id,email) select id,'custody-'||kind||'@sql.example.test' from custody_actors;
insert into public.app_members(user_id,display_name,role,active,can_manage_configuration)
select id,'Custody '||kind,case when kind='viewer' then 'viewer' else 'staff' end,
 kind<>'inactive',kind='maintainer' from custody_actors;
select set_config('request.jwt.claims',json_build_object('sub',
 (select id from custody_actors where kind='maintainer'),'role','authenticated')::text,true);

create temporary table custody_sites as
select (public.site_create(gen_random_uuid(),'{"code":"SITE-SQL-A","name":"Fictional Site A"}'::jsonb)->>'entity_id')::uuid as id,
 'a'::text as key;
insert into custody_sites
select (public.site_create(gen_random_uuid(),'{"code":"SITE-SQL-B","name":"Fictional Site B"}'::jsonb)->>'entity_id')::uuid,'b';
select is((select count(*)::integer from custody_sites),2,'maintainer creates distinct sites');

create temporary table custody_location as
select (public.location_create(gen_random_uuid(),jsonb_build_object(
 'code','ITO-SQL-BIN','name','Fictional office bin','parent_id',
 (select id from public.locations where code='ITO'),'kind','storage_area',
 'can_hold_inventory',true,'active',true,'sort_order',1))->>'entity_id')::uuid as id;
select ok((select id is not null from custody_location),'maintainer creates office storage');

select set_config('request.jwt.claims',json_build_object('sub',
 (select id from custody_actors where kind='staff'),'role','authenticated')::text,true);
select throws_ok($$select public.site_create(gen_random_uuid(),'{"code":"SITE-DENIED","name":"Denied"}'::jsonb)$$,
 'P1001','forbidden','ordinary staff cannot manage sites');
select throws_ok($$select public.location_create(gen_random_uuid(),'{"code":"ITO-DENIED","name":"Denied","kind":"room","active":true,"can_hold_inventory":false}'::jsonb)$$,
 'P1001','forbidden','ordinary staff cannot manage locations');

create temporary table custody_items as
select (public.quantity_create_v2(gen_random_uuid(),jsonb_build_object(
 'name','Fictional custody cable','category_id',(select id from public.categories where code='CABLES'),
 'initial_location_id',(select id from public.locations where code='ITC-S1A'),'initial_quantity',10,
 'expected_published_revision_id',(select published_form_revision_id from public.categories where code='CABLES'),
 'custom_patch','{}'::jsonb))->>'entity_id')::uuid as id;
select is((select available_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '10','initially all ten units are available storage stock');

create temporary table custody_receipts(result jsonb);
insert into custody_receipts
select public.quantity_site_change(gen_random_uuid(),jsonb_build_object(
 'action','issue','item_id',(select id from custody_items),'expected_version','1',
 'source_location_id',(select id from public.locations where code='ITC-S1A'),
 'destination_site_id',(select id from custody_sites where key='a'),'quantity',7));
select is((select available_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '3','issue reduces only available storage');
select is((select assigned_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '7','issue creates seven assigned units');
select is((select recorded_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '10','issue preserves recorded ownership');
select is((select count(*)::integer from public.assignment_events where item_id=(select id from custody_items)),
 1,'issue has one linked assignment event');

select throws_ok(format('select public.quantity_site_change(%L::uuid,%L::jsonb)',gen_random_uuid(),
 jsonb_build_object('action','issue','item_id',(select id from custody_items),'expected_version','1',
 'source_location_id',(select id from public.locations where code='ITC-S1A'),
 'destination_site_id',(select id from custody_sites where key='a'),'quantity',1)::text),
 'P1002','stale_version','old reviewed item version cannot issue again');
select throws_ok(format('select public.quantity_site_change(%L::uuid,%L::jsonb)',gen_random_uuid(),
 jsonb_build_object('action','issue','item_id',(select id from custody_items),'expected_version','2',
 'source_location_id',(select id from public.locations where code='ITC-S1A'),
 'destination_site_id',(select id from custody_sites where key='a'),'quantity',4)::text),
 'P1006','invalid_quantity','over-issue rolls back');

select public.quantity_site_change(gen_random_uuid(),jsonb_build_object(
 'action','transfer','item_id',(select id from custody_items),'expected_version','2',
 'source_site_id',(select id from custody_sites where key='a'),
 'destination_site_id',(select id from custody_sites where key='b'),'quantity',3));
select public.quantity_site_change(gen_random_uuid(),jsonb_build_object(
 'action','return','item_id',(select id from custody_items),'expected_version','3',
 'source_site_id',(select id from custody_sites where key='a'),
 'destination_location_id',(select id from custody_location),'quantity',2));
select is((select available_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '5','return increases available stock even at unmodeled office');
select is((select assigned_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '5','site transfer and partial return leave five assigned');
select throws_ok(format('select public.quantity_archive_and_clear(%L::uuid,%L::jsonb)',gen_random_uuid(),
 jsonb_build_object('item_id',(select id from custody_items),'expected_version','4',
 'confirm_clear_stock',true,'reason','Fictional test')::text),
 'P1008','assigned_stock_must_be_resolved','archive cannot clear outstanding site custody');

select public.quantity_site_change(gen_random_uuid(),jsonb_build_object(
 'action','write_off','item_id',(select id from custody_items),'expected_version','4',
 'source_site_id',(select id from custody_sites where key='b'),'quantity',1,'reason','Fictional damaged unit'));
select is((select recorded_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '9','write-off reduces recorded ownership with separate evidence');
select public.quantity_site_change(gen_random_uuid(),jsonb_build_object(
 'action','opening','item_id',(select id from custody_items),'expected_version','5',
 'destination_site_id',(select id from custody_sites where key='b'),'quantity',2,
 'reason','Fictional existing units discovered at site'));
select is((select recorded_quantity from public.inventory_quantity_totals where item_id=(select id from custody_items)),
 '11','existing-definition opening adds owned units without a storage issue');
select is((select count(*)::integer from public.quantity_event_lines l
 join public.quantity_events e on e.id=l.event_id where e.item_id=(select id from custody_items)
 and e.kind='site_opened'),0,'opening invents no storage ledger line');

select set_config('request.jwt.claims',json_build_object('sub',
 (select id from custody_actors where kind='maintainer'),'role','authenticated')::text,true);
create temporary table custody_inactive_site as
select (public.site_create(gen_random_uuid(),'{"code":"SITE-SQL-EMPTY","name":"Fictional Empty Site"}'::jsonb)->>'entity_id')::uuid as id;
select public.site_update(gen_random_uuid(),jsonb_build_object('site_id',
 (select id from custody_inactive_site),'expected_version','1','name','Fictional Empty Site',
 'active',false));
select throws_ok(format('select public.site_update(%L::uuid,%L::jsonb)',gen_random_uuid(),
 jsonb_build_object('site_id',(select id from custody_sites where key='a'),'expected_version','1',
 'name','Fictional Site A','active',false)::text),
 'P1008','site_has_inventory','site archive requires empty current holdings');
select lives_ok(format('select public.location_update(%L::uuid,%L::jsonb)',gen_random_uuid(),
 (select jsonb_build_object('location_id',id,'expected_version','1','name',name,
  'parent_id',parent_id,'kind',kind,'can_hold_inventory',can_hold_inventory,
  'active',false,'sort_order',sort_order)::text
  from public.locations where code='ITC-D12')),
 'an empty modeled drawer may be deactivated without changing geometry capability');
select ok((select not active and can_hold_inventory from public.locations where code='ITC-D12'),
 'deactivation leaves the explicit capability flag and modeled binding intact');
select set_config('request.jwt.claims',json_build_object('sub',
 (select id from custody_actors where kind='staff'),'role','authenticated')::text,true);
select throws_ok(format('select public.quantity_site_change(%L::uuid,%L::jsonb)',gen_random_uuid(),
 jsonb_build_object('action','correct','item_id',(select id from custody_items),
 'expected_version','6','source_site_id',(select id from custody_inactive_site),
 'observed_quantity',1,'reason','Fictional invalid correction')::text),
 'P1004','invalid_site','positive correction cannot create stock at an inactive site');

create temporary table custody_assets as
select (public.asset_create_v2(gen_random_uuid(),jsonb_build_object(
 'name','Fictional site laptop','category_id',(select id from public.categories where code='COMPUTERS'),
 'location_id',(select id from public.locations where code='ITC-D01'),
 'expected_published_revision_id',(select published_form_revision_id from public.categories where code='COMPUTERS'),
 'custom_patch','{}'::jsonb))->>'entity_id')::uuid as id;
select public.asset_site_change(gen_random_uuid(),jsonb_build_object('action','assign',
 'asset_id',(select id from custody_assets),'expected_version','1',
 'source_location_id',(select id from public.locations where code='ITC-D01'),
 'destination_site_id',(select id from custody_sites where key='a')));
select ok((select location_id is null and site_id=(select id from custody_sites where key='a')
 from public.serialized_assets where id=(select id from custody_assets)),
 'assigned asset has one exclusive site custody and no drawer location');
select throws_ok(format('select public.asset_move(%L::uuid,%L::jsonb)',gen_random_uuid(),
 jsonb_build_object('asset_id',(select id from custody_assets),'expected_version',2,
 'location_id',(select id from public.locations where code='ITC-D02'))::text),
 'P1008','site_custody_requires_assignment_operation','legacy asset move cannot bypass site history');
select public.asset_site_change(gen_random_uuid(),jsonb_build_object('action','correct',
 'asset_id',(select id from custody_assets),'expected_version','2',
 'source_site_id',(select id from custody_sites where key='a'),
 'destination_site_id',(select id from custody_sites where key='b'),
 'reason','Fictional record correction'));
select is((select kind from public.asset_events where asset_id=(select id from custody_assets) and version=3),
 'site_corrected','asset record correction is distinct from physical transfer');
select public.asset_site_change(gen_random_uuid(),jsonb_build_object('action','return',
 'asset_id',(select id from custody_assets),'expected_version','3',
 'source_site_id',(select id from custody_sites where key='b'),
 'destination_location_id',(select id from custody_location)));
select ok((select site_id is null and location_id=(select id from custody_location)
 from public.serialized_assets where id=(select id from custody_assets)),
 'return places asset at the unmodeled office destination');

select set_config('request.jwt.claims',json_build_object('sub',
 (select id from custody_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$insert into public.site_quantity_holdings(item_id,site_id,quantity)
 values(gen_random_uuid(),gen_random_uuid(),1)$$,'42501',null,
 'viewer cannot bypass RPC into site holdings');
select throws_ok($$update public.sites set active=false$$,'42501',null,
 'viewer cannot directly archive sites');
select throws_ok($$select public.quantity_site_change(gen_random_uuid(),'{}'::jsonb)$$,
 'P1001','forbidden','viewer cannot invoke assignment mutation');
reset role;

select * from finish();
rollback;
