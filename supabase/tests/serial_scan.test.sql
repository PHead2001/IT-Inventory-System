begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','inventory_serial_lookup_v1',array['text']);
select ok(not prosecdef and provolatile='s','serial discovery is stable and uses caller RLS')
from pg_proc where oid='public.inventory_serial_lookup_v1(text)'::regprocedure;
select ok(exists(select 1 from unnest(proconfig) setting where setting in ('search_path=""','search_path=')),
 'serial discovery pins empty search path') from pg_proc where oid='public.inventory_serial_lookup_v1(text)'::regprocedure;
select ok(not has_function_privilege(role_name,'public.inventory_serial_lookup_v1(text)','EXECUTE'),
 role_name||' cannot invoke serial discovery') from (values('anon'),('service_role')) roles(role_name);
select ok(not exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where p.oid='public.inventory_serial_lookup_v1(text)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE'),
 'PUBLIC has no serial discovery grant');
select ok(has_function_privilege('authenticated','public.inventory_serial_lookup_v1(text)','EXECUTE'),
 'authenticated may request authorized serial reads');

create temporary table serial_scan_actors(kind text primary key,id uuid default gen_random_uuid());
insert into serial_scan_actors(kind) values('staff'),('viewer'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,'serial-scan-'||kind||'@sql.example.test' from serial_scan_actors;
insert into public.app_members(user_id,display_name,role,active)
select id,'Serial scan '||kind,case when kind='viewer' then 'viewer' else 'staff' end,kind<>'inactive'
from serial_scan_actors where kind<>'nonmember';
grant select on serial_scan_actors to authenticated;
create temporary table serial_scan_rows(id uuid primary key,n integer);
insert into serial_scan_rows select gen_random_uuid(),n from generate_series(1,22) n;
insert into public.serialized_assets(id,name,category_id,location_id,asset_tag,serial_number,manufacturer,status)
select r.id,'Owned serial scan '||r.n,(select id from public.categories where code='COMPUTERS'),
 (select id from public.locations where code='ITC-RED'),'SQL-SERIAL-TAG-'||r.n,'Sn-Scan-Duplicate','Maker '||r.n,'active'
from serial_scan_rows r;
grant select on serial_scan_rows to authenticated;
create temporary table serial_scan_baseline as
select (select count(*) from public.serialized_assets) assets,(select count(*) from public.asset_events) events;
grant select on serial_scan_baseline to authenticated;
select set_config('request.jwt.claims',json_build_object('sub',(select id from serial_scan_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is(jsonb_array_length(public.inventory_serial_lookup_v1(E' \t sn-scan-duplicate \n ')),21,
 'viewer gets bounded 21-row snapshot for duplicate serials');
select is(public.inventory_serial_lookup_v1('sn-scan-duplicate')->0->>'serial_number','Sn-Scan-Duplicate',
 'database lower comparison preserves display spelling');
select is(public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')->0->>'location_code','ITC-RED',
 'current location is projected under caller RLS');
select is(public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')->0->>'site_name',null::text,
 'storage assets have no invented assigned site');
select is((select array_agg(value->>'id' order by ordinal)
 from jsonb_array_elements(public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')) with ordinality rows(value,ordinal)),
 (select array_agg(id::text order by id) from (select id from serial_scan_rows order by id limit 21) bounded),
 'UUID ordering provides a deterministic first21 bound');
select is(public.inventory_serial_lookup_v1('Unknown-Serial'),'[]'::jsonb,'unknown serial creates no match');
select is(public.inventory_serial_lookup_v1('Sn-Scan-Dup'),'[]'::jsonb,'serial matches are exact rather than prefix');
select throws_ok($$select public.inventory_serial_lookup_v1(repeat('x',201))$$,'P1012','invalid_serial','over200 rejected');
select throws_ok($$select public.inventory_serial_lookup_v1(E'x\ny')$$,'P1012','invalid_serial','embedded control rejected');
select is((select count(*) from public.serialized_assets),(select assets from serial_scan_baseline),'lookup leaves assets unchanged');
select is((select count(*) from public.asset_events),(select events from serial_scan_baseline),'lookup creates no inventory history');
select throws_ok($$update public.serialized_assets set name='Unauthorized'$$,'42501',null,'viewer has no direct-write bypass');
reset role;
-- Distinct Unicode fixture, plus site-held and retired context. All data belongs
-- to this transaction; no canonical location is renamed or fixture recycled.
update public.serialized_assets set serial_number=repeat(U&'\+01F600',200),name='Unicode serial display'
where id=(select id from serial_scan_rows where n=22);
insert into public.sites(code,name) values('SQL-SERIAL-SCAN','Owned serial scan site');
update public.serialized_assets set location_id=null,site_id=(select id from public.sites where code='SQL-SERIAL-SCAN'),serial_number='Site-Serial'
where id=(select id from serial_scan_rows where n=21);
update public.serialized_assets set status='retired',serial_number='Retired-Serial',location_id=null
where id=(select id from serial_scan_rows where n=20);
select set_config('request.jwt.claims',json_build_object('sub',(select id from serial_scan_actors where kind='staff'),'role','authenticated')::text,true);
set local role authenticated;
select is(jsonb_array_length(public.inventory_serial_lookup_v1(repeat(U&'\+01F600',200))),1,
 'staff can look up200 supplementary Unicode characters');
select is(public.inventory_serial_lookup_v1('site-serial')->0->>'site_name','Owned serial scan site','site context is current and named');
select is(public.inventory_serial_lookup_v1('site-serial')->0->>'location_name',null::text,'assigned asset has no invented storage');
select is(public.inventory_serial_lookup_v1('retired-serial')->0->>'status','retired','retired serial stays identifiable');
select is(public.inventory_serial_lookup_v1('retired-serial')->0->>'location_name',null::text,'retired missing storage stays unknown');
select is(jsonb_array_length(public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')),19,'later lookup reads changed serials without stale hydration');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from serial_scan_actors where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')$$,'P1001','forbidden','inactive member cannot look up serials');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from serial_scan_actors where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')$$,'P1001','forbidden','Auth account without membership cannot look up serials');
reset role;
set local role anon;
select throws_ok($$select public.inventory_serial_lookup_v1('Sn-Scan-Duplicate')$$,'42501',null,'anonymous cannot invoke serial discovery');
reset role;
select * from finish();
rollback;
