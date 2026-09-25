begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select is((select count(*)::integer from public.categories),8,'eight categories');
select is((select count(*)::integer from public.locations where code='ITC' or code like 'ITC-%'),35,'35 closet logical locations');
select is((select count(*)::integer from public.locations where (code='ITC' or code like 'ITC-%') and can_hold_inventory),28,'28 closet destination flags');
select is((select count(*)::integer from public.locations where (code='ITC' or code like 'ITC-%') and not can_hold_inventory),7,'seven closet aggregate flags');
select results_eq(
  'select name from public.categories order by sort_order',
  $$values ('Computers'),('Networking'),('Cables'),('Adapters'),('Peripherals'),('Parts'),('Tools'),('Other')$$,
  'exact category names and ordering'
);
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('public.app_members'::regclass,'public.categories'::regclass,'public.locations'::regclass)),'all application tables use RLS');
select throws_ok($$update public.locations set code='ITC-RENAMED' where code='ITC-RACK'$$,'23514','Location identity is immutable','code cannot change');
select throws_ok($$update public.locations set id=gen_random_uuid() where code='ITC-RACK'$$,'23514','Location identity is immutable','UUID cannot change');
select throws_ok($$update public.locations set parent_id=id where code='ITO-GENERAL'$$,'23514',null,'self-parent denied');
select throws_ok($$update public.locations set parent_id=gen_random_uuid() where code='ITO-GENERAL'$$,'23503',null,'missing parent denied');
select throws_ok($$update public.locations set parent_id=(select id from public.locations where code='ITC') where code='ITC-S1'$$,'P1008','modeled_location_shape_immutable','closet geometry binding cannot be reparented');
select throws_ok($$update public.locations set parent_id=(select id from public.locations where code='ITC-S1') where code='ITO-GENERAL'$$,'23514','Invalid location parent kind','unmodeled parent kind enforced');
insert into public.locations(code,name,parent_id,kind) select 'ITO-CYCLE-A','Cycle A',id,'storage_area' from public.locations where code='ITO';
insert into public.locations(code,name,parent_id,kind) select 'ITO-CYCLE-B','Cycle B',id,'storage_area' from public.locations where code='ITO';
select throws_ok($$update public.locations set parent_id=case code when 'ITO-CYCLE-A' then (select id from public.locations where code='ITO-CYCLE-B') else (select id from public.locations where code='ITO-CYCLE-A') end where code in ('ITO-CYCLE-A','ITO-CYCLE-B')$$,'23514','Location hierarchy cannot contain cycles','multirow cycle denied');
select throws_ok($$insert into public.categories(code,name) values ('DUPLICATE','computers')$$,'23505',null,'category normalized uniqueness');
select throws_ok($$insert into public.app_members(user_id,display_name,role) values(gen_random_uuid(),'Test','admin')$$,'23514',null,'only approved roles');

-- The boolean is independently editable; kind does not imply capability.
update public.locations set can_hold_inventory=false where code='ITO-GENERAL';
select ok((select kind='storage_area' and not can_hold_inventory from public.locations where code='ITO-GENERAL'),'location kind does not force capability');
update public.locations set can_hold_inventory=true,active=false where code='ITO-GENERAL';
select is((select count(*)::integer from public.locations where (code='ITC' or code like 'ITC-%') and active and can_hold_inventory),28,'closet destinations stay eligible');
select ok((select not active from public.locations where code='ITO-GENERAL'),'inactive office destination is ineligible');
update public.locations set active=true where code='ITO-GENERAL';

create temporary table test_identities(kind text primary key, id uuid not null default gen_random_uuid());
insert into test_identities(kind) values ('viewer'),('staff'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,kind||'@sql.example.test' from test_identities;
insert into public.app_members(user_id,display_name,role,active)
select id,'Test '||kind,case when kind='viewer' then 'viewer' else 'staff' end,kind<>'inactive'
from test_identities where kind<>'nonmember';

select set_config('request.jwt.claims',json_build_object('sub',(select id from test_identities where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.categories),8,'viewer reads categories');
select ok((select count(*)::integer from public.locations)>=37,'viewer reads closet plus office locations');
select is((select count(*)::integer from public.app_members),1,'viewer reads only own active membership');
select throws_ok($$insert into public.categories(code,name) values('NEW','New')$$,'42501',null,'viewer cannot insert');
select throws_ok($$update public.app_members set role='staff'$$,'42501',null,'viewer cannot escalate membership');
select throws_ok($$delete from public.locations$$,'42501',null,'viewer cannot delete');
select throws_ok($$truncate public.categories$$,'42501',null,'viewer cannot truncate');
select throws_ok($$select * from private.location_hierarchy_guard$$,'42501',null,'private guard inaccessible');
reset role;

select set_config('request.jwt.claims',json_build_object('sub',(select id from test_identities where kind='staff'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.categories),8,'staff reads categories');
select ok((select count(*)::integer from public.locations)>=37,'staff reads closet plus office locations');
select is((select count(*)::integer from public.app_members),1,'staff reads own membership');
select throws_ok($$insert into public.locations(code,name,kind) values('ROOM2','Other room','room')$$,'42501',null,'staff cannot insert directly');
select throws_ok($$update public.locations set can_hold_inventory=true$$,'42501',null,'staff cannot update directly');
select throws_ok($$delete from public.app_members$$,'42501',null,'staff cannot delete memberships');
select throws_ok($$truncate public.categories$$,'42501',null,'staff cannot truncate');
reset role;

-- Existing claims cannot retain access after membership deactivation.
update public.app_members set active=false where user_id=(select id from test_identities where kind='staff');
set local role authenticated;
select is((select count(*)::integer from public.locations),0,'deactivation denies next read with existing claims');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from test_identities where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.categories),0,'inactive member reads no categories');
select is((select count(*)::integer from public.locations),0,'inactive member reads no locations');
select is((select count(*)::integer from public.app_members),0,'inactive membership hidden');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from test_identities where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select is((select count(*)::integer from public.categories),0,'nonmember reads no categories');
select is((select count(*)::integer from public.locations),0,'nonmember reads no locations');
select is((select count(*)::integer from public.app_members),0,'nonmember reads no memberships');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
select throws_ok($$select * from public.locations$$,'42501',null,'anonymous location read denied');
select throws_ok($$select * from public.categories$$,'42501',null,'anonymous category read denied');
select throws_ok($$select * from public.app_members$$,'42501',null,'anonymous membership read denied');
reset role;
select * from finish();
rollback;
