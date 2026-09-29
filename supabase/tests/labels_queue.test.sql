begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select has_function('public','inventory_label_search',
 array['text','text','text','uuid','text','integer','integer'],
 'record-level label search exists');
select has_function('public','inventory_label_resolve',array['jsonb'],
 'exact mixed-queue resolver exists');
select ok(not p.prosecdef,'label RPC uses invoker RLS')
from pg_proc p where p.oid in (
 'public.inventory_label_search(text,text,text,uuid,text,integer,integer)'::regprocedure,
 'public.inventory_label_resolve(jsonb)'::regprocedure);
select ok(not has_function_privilege('anon',fn,'EXECUTE'),
 'anonymous label RPC execution denied: '||fn)
from (values
 ('public.inventory_label_search(text,text,text,uuid,text,integer,integer)'),
 ('public.inventory_label_resolve(jsonb)')) f(fn);

create temporary table label_actors(kind text primary key,id uuid not null default gen_random_uuid());
insert into label_actors(kind) values ('viewer'),('outsider');
insert into auth.users(id,email)
select id,'label-'||kind||'@sql.example.test' from label_actors;
insert into public.app_members(user_id,display_name,role,active)
select id,'Label viewer','viewer',true from label_actors where kind='viewer';

insert into public.quantity_items(name,category_id,manufacturer,model)
values ('QueueSearch Cables',(select id from public.categories where code='CABLES'),
 'Northwind','C-100'),
 ('QueueSearch Zero',(select id from public.categories where code='CABLES'),
 'Northwind','Z-100');
insert into public.quantity_items(name,category_id,archived)
values ('QueueSearch Historical',(select id from public.categories where code='CABLES'),true);
insert into public.quantity_items(name,category_id)
select 'PageCap '||n,(select id from public.categories where code='CABLES')
from generate_series(1,60) n;
insert into public.stock_balances(item_id,location_id,quantity)
select q.id,l.id,5 from public.quantity_items q cross join public.locations l
where q.name='QueueSearch Cables' and l.code in ('ITC-S1A','ITC-S1B');
insert into public.serialized_assets(name,category_id,location_id,asset_tag,serial_number)
select 'QueueSearch Asset',c.id,l.id,'queue-search-tag','QueueSearch SN'
from public.categories c cross join public.locations l
where c.code='COMPUTERS' and l.code='ITC-D01';

select set_config('request.jwt.claims',json_build_object(
 'sub',(select id from label_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is((public.inventory_label_search('QueueSearch')->>'total')::integer,3,
 'two active quantity definitions and one asset count once, despite multiple balances');
select is(jsonb_array_length(public.inventory_label_search('QueueSearch','all','active',null,null,1,1)->'rows'),1,
 'record-level paging returns one row');
select is((public.inventory_label_search('PageCap','all','active',null,null,1,100)->>'total')::integer,60,
 'page-size cap retains the deduplicated total');
select is(jsonb_array_length(public.inventory_label_search('PageCap','all','active',null,null,1,100)->'rows'),50,
 'oversized page-size request is clamped to fifty records');
select is((public.inventory_label_search('QueueSearch','all','active',null,null,2,1)->>'total')::integer,3,
 'deduplication and count happen before page two');
select is((public.inventory_label_search('QueueSearch Zero')->>'total')::integer,1,
 'zero-stock definition remains searchable');
select is((public.inventory_label_search('QueueSearch Cables')->'rows'->0->>'holding_context'),
 'IT Closet / Left Storage / Shelf 1 / 1A: 5; IT Closet / Left Storage / Shelf 1 / 1B: 5',
 'deduplicated quantity search shows both readable holding paths and counts');
select is((public.inventory_label_search('QueueSearch Zero')->'rows'->0->>'holding_context'),
 'No positive stock','zero-stock result explains its unlocated state');
select is((public.inventory_label_search('QueueSearch','all','historical')->>'total')::integer,1,
 'historical definitions require the explicit historical filter');
select is((public.inventory_label_search('C-100')->>'total')::integer,1,
 'model is searchable');
select is((public.inventory_label_search('QueueSearch SN')->>'total')::integer,1,
 'serial number is searchable');
select is((public.inventory_label_search('queue-search-tag')->>'total')::integer,1,
 'asset tag is searchable');
select is((public.inventory_label_search(
  (select id::text from public.quantity_items where name='QueueSearch Zero'))
  ->>'total')::integer,1,'exact UUID is searchable');
select is((public.inventory_label_search('QueueSearch','quantity','active',null,'ITC-S1A')->>'total')::integer,1,
 'location filtering matches the holding but still returns the definition once');
select is(jsonb_array_length(public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','location','key','ITC'),
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Zero')),
 jsonb_build_object('kind','asset','key',
  (select id::text from public.serialized_assets where name='QueueSearch Asset'))))),3,
 'one caller-scoped snapshot resolves mixed exact IDs');
select is(public.inventory_label_resolve('[{"kind":"location","key":"ITC"}]'::jsonb)
 ->0->>'key','ITC','location QR target retains its stable code');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'key'),
 (select id::text from public.quantity_items where name='QueueSearch Cables'),
 'quantity QR target retains its immutable UUID');
select ok((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'context') like '%IT Closet / Left Storage / Shelf 1 / 1A: 5; IT Closet / Left Storage / Shelf 1 / 1B: 5%',
 'queued quantity context contains both readable holding paths and counts');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'holding_context'),
 'IT Closet / Left Storage / Shelf 1 / 1A: 5; IT Closet / Left Storage / Shelf 1 / 1B: 5',
 'screen holding context remains live and separate from print fields');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'model'),'C-100','quantity print projection keeps product model');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'manufacturer'),'Northwind','quantity print projection keeps manufacturer');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'location_hierarchy'),null,'quantity print projection has no current storage path');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','asset','key',
  (select id::text from public.serialized_assets where name='QueueSearch Asset'))))
 ->0->>'serial_number'),'QueueSearch SN','asset print projection keeps serial');
select is((public.inventory_label_resolve('[{"kind":"location","key":"ITC"}]'::jsonb)
 ->0->>'location_hierarchy'),'IT Closet','location print projection keeps its own hierarchy');
select throws_ok($$select public.inventory_label_resolve('[{"key":"ITC"}]'::jsonb)$$,
 '22023','invalid_label_selection','missing kind is rejected');
reset role;

update public.stock_balances set quantity=9 where item_id=(
 select id from public.quantity_items where name='QueueSearch Cables')
 and location_id=(select id from public.locations where code='ITC-S1A');
select set_config('request.jwt.claims',json_build_object(
 'sub',(select id from label_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'holding_context'),
 'IT Closet / Left Storage / Shelf 1 / 1A: 9; IT Closet / Left Storage / Shelf 1 / 1B: 5',
 'screen holding context changes after balance changes');
select is((public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','quantity','key',
  (select id::text from public.quantity_items where name='QueueSearch Cables'))))
 ->0->>'model'),'C-100','print product model stays stable after balance changes');
reset role;

select set_config('request.jwt.claims',json_build_object(
 'sub',(select id from label_actors where kind='outsider'),'role','authenticated')::text,true);
set local role authenticated;
select is((public.inventory_label_search('QueueSearch')->>'total')::integer,0,
 'nonmember cannot search labels through invoker view');
select is(jsonb_array_length(public.inventory_label_resolve(jsonb_build_array(
 jsonb_build_object('kind','location','key','ITC')))),0,
 'nonmember cannot resolve even a known location');
reset role;

select * from finish();
rollback;
