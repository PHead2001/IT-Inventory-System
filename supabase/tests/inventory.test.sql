begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table inventory_test_operations(name text primary key);
insert into inventory_test_operations values
  ('quantity_create'), ('quantity_receive'), ('quantity_move'), ('quantity_adjust'),
  ('quantity_update'), ('quantity_archive'), ('quantity_archive_and_clear'), ('quantity_restore'),
  ('asset_create'), ('asset_move'), ('asset_correct_location'), ('asset_update'),
  ('asset_retire'), ('asset_restore');
grant select on inventory_test_operations to authenticated, anon;

create temporary table inventory_test_tables(name text primary key);
insert into inventory_test_tables values
  ('quantity_items'), ('stock_balances'), ('quantity_events'),
  ('quantity_event_lines'), ('serialized_assets'), ('asset_events');
grant select on inventory_test_tables to authenticated, anon;

select has_table('public', name, name || ' exists') from inventory_test_tables;
select ok(c.relrowsecurity, c.relname || ' enables RLS')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
join inventory_test_tables t on t.name=c.relname where n.nspname='public';

select ok(not has_table_privilege(role_name,'public.'||name,privilege_name),
          role_name||' cannot directly '||privilege_name||' '||name)
from inventory_test_tables
cross join (values ('anon'),('authenticated'),('service_role')) as roles(role_name)
cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) as privileges(privilege_name);

select ok(not has_table_privilege('anon','public.'||name,'SELECT'),
          'anonymous cannot read '||name) from inventory_test_tables;
select ok(has_table_privilege('authenticated','public.'||name,'SELECT'),
          'authenticated can request RLS-filtered reads of '||name) from inventory_test_tables;

select has_function('public',name,array['uuid','jsonb'],name||' has the agreed RPC signature')
from inventory_test_operations;
select ok(p.prosecdef, t.name||' is SECURITY DEFINER')
from inventory_test_operations t join pg_proc p on p.oid=to_regprocedure('public.'||t.name||'(uuid,jsonb)');
select ok(exists(select 1 from unnest(p.proconfig) as setting where setting in ('search_path=""','search_path=')),
          t.name||' pins an empty search_path')
from inventory_test_operations t join pg_proc p on p.oid=to_regprocedure('public.'||t.name||'(uuid,jsonb)');
select ok(has_function_privilege('authenticated','public.'||name||'(uuid,jsonb)','EXECUTE'),
          'authenticated may invoke '||name) from inventory_test_operations;
select ok(not has_function_privilege('anon','public.'||name||'(uuid,jsonb)','EXECUTE'),
          'anonymous cannot invoke '||name) from inventory_test_operations;
select ok(not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                     where a.grantee=0 and a.privilege_type='EXECUTE'),
          t.name||' does not grant PUBLIC execution')
from inventory_test_operations t join pg_proc p on p.oid=to_regprocedure('public.'||t.name||'(uuid,jsonb)');
select has_function('public','quantity_archive_review',array['uuid'],'archive review has one-argument read signature');
select ok(not (select prosecdef from pg_proc where oid='public.quantity_archive_review(uuid)'::regprocedure),
          'archive review uses caller RLS');
select ok(has_function_privilege('authenticated','public.quantity_archive_review(uuid)','EXECUTE'),
          'authenticated members may request an RLS-filtered archive review');
select ok(not has_function_privilege('anon','public.quantity_archive_review(uuid)','EXECUTE'),
          'anonymous users cannot request archive reviews');

create temporary table inventory_test_actors(kind text primary key,id uuid not null default gen_random_uuid());
insert into inventory_test_actors(kind) values ('staff'),('viewer'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,'inventory-'||kind||'@sql.example.test' from inventory_test_actors;
insert into public.app_members(user_id,display_name,role,active)
select id,'Inventory '||kind,case when kind='viewer' then 'viewer' else 'staff' end,kind<>'inactive'
from inventory_test_actors where kind<>'nonmember';

-- Persist a real row in each table so RLS tests cannot pass against empty tables.
select set_config('request.jwt.claims',json_build_object('sub',(select id from inventory_test_actors where kind='staff'),'role','authenticated')::text,true);
select public.quantity_create(gen_random_uuid(),jsonb_build_object(
  'name','SQL inventory fixture','category_id',(select id from public.categories where code='CABLES'),
  'initial_quantity',2,'initial_location_id',(select id from public.locations where code='ITC-S1A')));
select public.asset_create(gen_random_uuid(),jsonb_build_object(
  'name','SQL asset fixture','category_id',(select id from public.categories where code='COMPUTERS'),
  'location_id',(select id from public.locations where code='ITC-D01')));
create temporary table inventory_test_item as
select id from public.quantity_items where name='SQL inventory fixture';
grant select on inventory_test_item to authenticated, anon;

set local role authenticated;
select ok((select count(*) from public.quantity_items)>0,'staff reads quantity definitions');
select ok((select count(*) from public.asset_events)>0,'staff reads asset history');
select is((public.quantity_archive_review((select id from inventory_test_item))->>'removed_total'),
          '2','archive review reports the same stock as the item snapshot');
reset role;

select set_config('request.jwt.claims',json_build_object('sub',(select id from inventory_test_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select results_eq(format('select count(*) > 0 from public.%I',name),array[true],
                  'viewer reads seeded '||name) from inventory_test_tables;
select is((public.quantity_archive_review((select id from inventory_test_item))->>'removed_total'),
          '2','viewer can read but not mutate the archive review');
select throws_ok(format('select public.%I(%L::uuid,%L::jsonb)',name,gen_random_uuid(),'{}'),
                 'P1001',null,'viewer is forbidden from '||name) from inventory_test_operations;
select throws_ok(format('update public.%I set %I=%I',name,
                 case when name in ('stock_balances','quantity_event_lines') then 'location_id' else 'id' end,
                 case when name in ('stock_balances','quantity_event_lines') then 'location_id' else 'id' end),
                 '42501',null,'viewer direct update denied for '||name) from inventory_test_tables;
reset role;

select set_config('request.jwt.claims',json_build_object('sub',(select id from inventory_test_actors where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select results_eq(format('select count(*) from public.%I',name),array[0::bigint],
                  'inactive member cannot read '||name) from inventory_test_tables;
select is(public.quantity_archive_review((select id from inventory_test_item)),
          null::jsonb,'inactive member cannot read archive review');
select throws_ok(format('select public.%I(%L::uuid,%L::jsonb)',name,gen_random_uuid(),'{}'),
                 'P1001',null,'inactive member is forbidden from '||name) from inventory_test_operations;
reset role;

select set_config('request.jwt.claims',json_build_object('sub',(select id from inventory_test_actors where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select results_eq(format('select count(*) from public.%I',name),array[0::bigint],
                  'nonmember cannot read '||name) from inventory_test_tables;
select is(public.quantity_archive_review((select id from inventory_test_item)),
          null::jsonb,'nonmember cannot read archive review');
select throws_ok(format('select public.%I(%L::uuid,%L::jsonb)',name,gen_random_uuid(),'{}'),
                 'P1001',null,'nonmember is forbidden from '||name) from inventory_test_operations;
reset role;

select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok(format('select * from public.%I',name),'42501',null,
                 'anonymous read denied for '||name) from inventory_test_tables;
select throws_ok(format('select public.%I(%L::uuid,%L::jsonb)',name,gen_random_uuid(),'{}'),
                 '42501',null,'anonymous execution denied for '||name) from inventory_test_operations;
reset role;

select throws_ok($$update public.stock_balances set quantity=-1$$,'23514',null,'negative persisted balances are invalid');
select throws_ok($$update public.stock_balances set quantity=2147483648$$,'22003',null,'persisted quantities stay within integer bounds');
select throws_ok($$insert into public.stock_balances(item_id,location_id,quantity) select item_id,location_id,quantity from public.stock_balances$$,
                 '23505',null,'only one balance per item/location');
select throws_ok($$update public.stock_balances set location_id=gen_random_uuid()$$,'23503',null,'balances require a real location');
select throws_ok($$update public.quantity_items set category_id=gen_random_uuid()$$,'23503',null,'items require a real category');
select throws_ok($$update public.serialized_assets set location_id=gen_random_uuid()$$,'23503',null,'assets require a real location');
select throws_ok($$update public.serialized_assets set status='deleted'$$,'23514',null,'asset status is constrained');
select throws_ok($$update public.quantity_items set version=0$$,'23514',null,'quantity versions are positive');
select throws_ok($$update public.serialized_assets set version=0$$,'23514',null,'asset versions are positive');
select throws_ok($$update public.quantity_items set name=' '$$,'23514',null,'blank item names are invalid');

select throws_ok(format('update public.%I set %I=%I',name,
                 case when name='quantity_event_lines' then 'event_id' else 'id' end,
                 case when name='quantity_event_lines' then 'event_id' else 'id' end),
                 '42501','Inventory history is append-only','even owner cannot update '||name)
from inventory_test_tables where name in ('quantity_events','quantity_event_lines','asset_events');
select throws_ok(format('delete from public.%I',name),
                 '42501','Inventory history is append-only','even owner cannot delete '||name)
from inventory_test_tables where name in ('quantity_events','quantity_event_lines','asset_events');
select throws_ok($$insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
  select e.id,l.id,1,2,4 from public.quantity_events e cross join public.locations l
  where l.code='ITC-S1B' limit 1$$,'23514',null,'audit line before plus delta must equal after');
select throws_ok($$insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
  select e.id,l.id,0,2,2 from public.quantity_events e cross join public.locations l
  where l.code='ITC-S1B' limit 1$$,'23514',null,'audit lines cannot contain zero deltas');
select ok(not has_table_privilege(role_name,'private.mutation_requests',privilege_name),
          role_name||' cannot '||privilege_name||' private mutation receipts')
from (values ('anon'),('authenticated'),('service_role')) as roles(role_name)
cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) as privileges(privilege_name);

-- A failing final history write must roll back state, version, history, and receipt.
-- These triggers exist only inside this rolled-back pgTAP transaction.
select set_config('request.jwt.claims',json_build_object('sub',(select id from inventory_test_actors where kind='staff'),'role','authenticated')::text,true);
create temporary table inventory_rollback_state as
select gen_random_uuid() as quantity_request,gen_random_uuid() as asset_request,
       (select to_jsonb(q) from public.quantity_items q where name='SQL inventory fixture') as quantity_before,
       (select to_jsonb(a) from public.serialized_assets a where name='SQL asset fixture') as asset_before,
       (select jsonb_agg(to_jsonb(b) order by item_id,location_id) from public.stock_balances b) as balances_before,
       (select count(*) from public.quantity_events) as quantity_events_before,
       (select count(*) from public.quantity_event_lines) as lines_before,
       (select count(*) from public.asset_events) as asset_events_before,
       (select count(*) from private.mutation_requests) as receipts_before;
create function pg_temp.inventory_fail_history() returns trigger language plpgsql as $$
begin raise exception using errcode='P1999',message='Injected history failure'; end;
$$;
create trigger inventory_test_quantity_failure before insert on public.quantity_event_lines
for each row execute function pg_temp.inventory_fail_history();
select throws_ok(format('select public.quantity_receive(%L::uuid,%L::jsonb)',quantity_request,
  jsonb_build_object('item_id',quantity_before->>'id','expected_version',1,
    'location_id',(select id from public.locations where code='ITC-S1A'),
    'quantity',3,'reason','Rollback proof')),
  'P1999','Injected history failure','history-line failure aborts the quantity transaction')
from inventory_rollback_state;
drop trigger inventory_test_quantity_failure on public.quantity_event_lines;
create trigger inventory_test_archive_failure before insert on public.quantity_event_lines
for each row execute function pg_temp.inventory_fail_history();
select throws_ok(format('select public.quantity_archive_and_clear(%L::uuid,%L::jsonb)',quantity_request,
  jsonb_build_object('item_id',quantity_before->>'id','expected_version','1',
    'confirm_clear_stock',true,'reason','Rollback archive proof')),
  'P1999','Injected history failure','archive line failure aborts stock removal and archive state')
from inventory_rollback_state;
drop trigger inventory_test_archive_failure on public.quantity_event_lines;
create trigger inventory_test_asset_failure before insert on public.asset_events
for each row execute function pg_temp.inventory_fail_history();
select throws_ok(format('select public.asset_move(%L::uuid,%L::jsonb)',asset_request,
  jsonb_build_object('asset_id',asset_before->>'id','expected_version',1,
    'location_id',(select id from public.locations where code='ITC-S1A'))),
  'P1999','Injected history failure','history failure aborts the asset transaction')
from inventory_rollback_state;
drop trigger inventory_test_asset_failure on public.asset_events;
select is((select to_jsonb(q) from public.quantity_items q where name='SQL inventory fixture'),quantity_before,
          'quantity state and version roll back') from inventory_rollback_state;
select is((select to_jsonb(a) from public.serialized_assets a where name='SQL asset fixture'),asset_before,
          'asset state and version roll back') from inventory_rollback_state;
select is((select jsonb_agg(to_jsonb(b) order by item_id,location_id) from public.stock_balances b),balances_before,
          'all balances roll back') from inventory_rollback_state;
select is((select count(*) from public.quantity_events),quantity_events_before,'quantity events roll back') from inventory_rollback_state;
select is((select count(*) from public.quantity_event_lines),lines_before,'quantity event lines roll back') from inventory_rollback_state;
select is((select count(*) from public.asset_events),asset_events_before,'asset events roll back') from inventory_rollback_state;
select is((select count(*) from private.mutation_requests),receipts_before,'failed operations leave no receipts') from inventory_rollback_state;

select * from finish();
rollback;
