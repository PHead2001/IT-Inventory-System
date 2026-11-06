begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','overview_snapshot_v1',array['text']);
select ok(not p.prosecdef,'Overview preserves caller RLS') from pg_proc p
 where p.oid='public.overview_snapshot_v1(text)'::regprocedure;
select ok(p.provolatile='s','Overview is a stable statement-snapshot read') from pg_proc p
 where p.oid='public.overview_snapshot_v1(text)'::regprocedure;
select ok('statement_timeout=5s'=any(p.proconfig),'Overview declares five-second function defense')
 from pg_proc p where p.oid='public.overview_snapshot_v1(text)'::regprocedure;
select ok(exists(select 1 from unnest(p.proconfig) s where s in ('search_path=""','search_path=')),
 'Overview pins empty search path') from pg_proc p where p.oid='public.overview_snapshot_v1(text)'::regprocedure;
select ok(not has_function_privilege(r,'public.overview_snapshot_v1(text)','EXECUTE'),r||' cannot invoke Overview')
 from (values ('anon'),('service_role')) roles(r);
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
 where p.oid='public.overview_snapshot_v1(text)'::regprocedure and a.grantee=0),
 'Overview does not inherit PUBLIC execution');

create temporary table overview_actors(kind text,id uuid default gen_random_uuid());
insert into overview_actors(kind) values ('staff'),('viewer'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,'overview-'||kind||'@sql.example.test' from overview_actors;
insert into public.app_members(user_id,display_name,role,active)
 select id,kind,case when kind='viewer' then 'viewer' else 'staff' end,kind<>'inactive'
 from overview_actors where kind<>'nonmember';
grant select on overview_actors to authenticated;
select set_config('request.jwt.claims',json_build_object('sub',(select id from overview_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is(public.overview_snapshot_v1()->'stock'->>'monitoredItems','0','empty database has zero monitored definitions');
select is(public.overview_snapshot_v1()->'stockTrends','[]'::jsonb,'empty database does not fabricate stock series');
select is(jsonb_array_length(public.overview_snapshot_v1()->'activity'->'points'),14,'empty activity still has fourteen known dates');
select throws_ok($$select public.overview_snapshot_v1('CST')$$,'P1012','invalid_time_zone','reject ambiguous abbreviation');
select throws_ok($$select public.overview_snapshot_v1('Etc/Imaginary')$$,'P1012','invalid_time_zone','reject unknown zone');
select throws_ok($$select public.overview_snapshot_v1(null)$$,'P1012','invalid_time_zone','reject null zone');
select throws_ok($$select public.overview_snapshot_v1(repeat('x',101))$$,'P1012','invalid_time_zone','reject oversized zone');
select is(public.overview_snapshot_v1('America/Chicago')->>'timeZone','America/Chicago','viewer can read with explicit named zone');
reset role;

-- Known calendar transitions prove the calendar arithmetic used by the RPC;
-- no caller-controlled as-of clock/date is exposed just to facilitate a test.
select is(extract(epoch from ('2026-03-09'::timestamp at time zone 'America/Chicago')-
 ('2026-03-08'::timestamp at time zone 'America/Chicago'))::bigint,82800::bigint,
 'spring calendar day has 23 hours');
select is(extract(epoch from ('2026-11-02'::timestamp at time zone 'America/Chicago')-
 ('2026-11-01'::timestamp at time zone 'America/Chicago'))::bigint,90000::bigint,
 'fall calendar day has 25 hours');

create temporary table overview_items(label text primary key,id uuid default gen_random_uuid());
insert into overview_items(label) values ('A valid'),('B zero'),('C site opening');
insert into public.quantity_items(id,name,category_id,reorder_threshold,version,created_at)
 select id,label,(select id from public.categories where code='CABLES'),
 case when label='C site opening' then null else 20 end,
 case when label='A valid' then 12 else 1 end,
 case when label='C site opening' then now()-interval '1 day' else now()-interval '30 days' end
 from overview_items;
create temporary table overview_ledger(version integer,kind text,day_offset integer);
insert into overview_ledger values (1,'created',30),(2,'received',20),(3,'moved',19),
 (4,'adjusted',18),(5,'site_issued',17),(6,'site_returned',16),
 (7,'site_transferred',15),(8,'site_corrected',14),(9,'site_written_off',13),
 (10,'metadata_updated',12),(11,'archived',11),(12,'restored',10);
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select (select id from overview_items where label='A valid'),kind,(select id from overview_actors where kind='staff'),
 'staff',version,now()-day_offset*interval '1 day' from overview_ledger;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select i.id,case when i.label='C site opening' then 'site_opened' else 'created' end,
 (select id from overview_actors where kind='staff'),'staff',1,q.created_at
 from overview_items i join public.quantity_items q on q.id=i.id where i.label<>'A valid';
-- Receive/correct/issue/return/clear deltas, net-zero moves and site-only events.
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,v.delta,v.before_quantity,v.after_quantity
 from (values (1,'ITC-S1A',10,0,10),(2,'ITC-S1A',5,10,15),
  (3,'ITC-S1A',-4,15,11),(3,'ITC-S1B',4,0,4),
  (4,'ITC-S1A',-2,11,9),(5,'ITC-S1A',-3,9,6),
  (6,'ITC-S1B',2,4,6),(11,'ITC-S1A',-6,6,0),(11,'ITC-S1B',-6,6,0))
  v(version,code,delta,before_quantity,after_quantity)
 join public.quantity_events e on e.item_id=(select id from overview_items where label='A valid') and e.version=v.version
 join public.locations l on l.code=v.code;
insert into public.stock_balances(item_id,location_id,quantity)
 select (select id from overview_items where label='A valid'),id,0 from public.locations where code in ('ITC-S1A','ITC-S1B');
-- Privileged historical fixture: topology is inactive before retained custody
-- is recorded. Normal deactivation correctly refuses occupied sites.
insert into public.sites(code,name,active) values ('OVERVIEW-SITE','Overview site',false),('OVERVIEW-SECOND','Overview second',true);
insert into public.site_quantity_holdings(item_id,site_id,quantity)
 select i.id,s.id,0 from overview_items i cross join public.sites s
 where i.label='A valid' and s.code in ('OVERVIEW-SITE','OVERVIEW-SECOND');
insert into public.site_quantity_event_lines(event_id,site_id,delta,before_quantity,after_quantity)
 select e.id,s.id,v.delta,v.before_quantity,v.after_quantity
 from (values (5,'OVERVIEW-SITE',3,0,3),(6,'OVERVIEW-SITE',-2,3,1),
  (7,'OVERVIEW-SITE',-1,1,0),(7,'OVERVIEW-SECOND',1,0,1),
  (8,'OVERVIEW-SECOND',1,1,2),(9,'OVERVIEW-SECOND',-2,2,0))
  v(version,code,delta,before_quantity,after_quantity)
 join public.quantity_events e on e.item_id=(select id from overview_items where label='A valid') and e.version=v.version
 join public.sites s on s.code=v.code;
insert into public.assignment_events(quantity_event_id,item_id,kind,actor_id,actor_name,
 from_location_id,to_location_id,from_site_id,to_site_id,from_label,to_label,quantity,created_at)
 select e.id,e.item_id,v.kind,e.actor_id,e.actor_name,
 fl.id,tl.id,fs.id,ts.id,coalesce(fl.name,fs.name),coalesce(tl.name,ts.name),v.amount,e.created_at
 from (values (5,'issued','ITC-S1A',null,null,'OVERVIEW-SITE',3),
  (6,'returned',null,'ITC-S1B','OVERVIEW-SITE',null,2),
  (7,'transferred',null,null,'OVERVIEW-SITE','OVERVIEW-SECOND',1),
  (8,'corrected',null,null,'OVERVIEW-SECOND',null,1),
  (9,'written_off',null,null,'OVERVIEW-SECOND',null,2))
  v(version,kind,from_location,to_location,from_site,to_site,amount)
 join public.quantity_events e on e.item_id=(select id from overview_items where label='A valid') and e.version=v.version
 left join public.locations fl on fl.code=v.from_location left join public.locations tl on tl.code=v.to_location
 left join public.sites fs on fs.code=v.from_site left join public.sites ts on ts.code=v.to_site;
insert into public.site_quantity_holdings(item_id,site_id,quantity)
 select i.id,s.id,7 from overview_items i cross join public.sites s where i.label='C site opening' and s.code='OVERVIEW-SITE';
insert into public.site_quantity_event_lines(event_id,site_id,delta,before_quantity,after_quantity)
 select e.id,s.id,7,0,7 from public.quantity_events e cross join public.sites s
 where e.item_id=(select id from overview_items where label='C site opening') and s.code='OVERVIEW-SITE';
insert into public.assignment_events(quantity_event_id,item_id,kind,actor_id,actor_name,to_site_id,to_label,quantity)
 select e.id,e.item_id,'opened',e.actor_id,e.actor_name,s.id,s.name,7
 from public.quantity_events e cross join public.sites s
 where e.item_id=(select id from overview_items where label='C site opening') and s.code='OVERVIEW-SITE';
insert into public.serialized_assets(id,name,category_id,location_id,site_id,created_at)
 select '00000000-0000-4000-8000-000000000004','Site equipment',
 (select id from public.categories where code='COMPUTERS'),null,id,now()-interval '1 day'
 from public.sites where code='OVERVIEW-SITE';
insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,version,created_at)
 values ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000004',
 'site_opened',(select id from overview_actors where kind='staff'),'staff',1,now()-interval '1 day');
insert into public.assignment_events(asset_event_id,asset_id,kind,actor_id,actor_name,to_site_id,to_label,created_at)
 select e.id,e.asset_id,'opened',e.actor_id,e.actor_name,s.id,s.name,e.created_at
 from public.asset_events e cross join public.sites s
 where e.id='00000000-0000-4000-8000-000000000005' and s.code='OVERVIEW-SITE';
set constraints all immediate;
grant select on overview_items to authenticated;
select set_config('request.jwt.claims',json_build_object('sub',(select id from overview_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
create temporary table overview_snapshot as select public.overview_snapshot_v1() as value;
select is(value->'stock'->>'needsAttention','2','configured zero stock needs attention') from overview_snapshot;
select is(value->'stock'->>'zeroAvailable','2','zero stock is an attention subset') from overview_snapshot;
select is(value->'stock'->>'unmonitoredItems','1','null threshold stays unmonitored') from overview_snapshot;
select is(value->'atSites'->>'quantityDefinitions','1','site summary counts definitions rather than heterogeneous units') from overview_snapshot;
select is(value->'atSites'->>'occupiedSites','1','site summary counts actual occupied sites') from overview_snapshot;
select is(value->'atSites'->>'assets','1','site summary keeps individual assets separate') from overview_snapshot;
select is((select r->>'quantity' from jsonb_array_elements(value->'atSites'->'rows') r where r->>'kind'='quantity'),
 '7','site holding remains a per-definition quantity') from overview_snapshot;
select is(jsonb_array_length(value->'recentEvents'),10,'Overview returns only the last ten events') from overview_snapshot;
select is(value->'recentEvents'->0->>'recordKind','asset','tied event times use the declared kind tie order') from overview_snapshot;
select is(value->'recentEvents'->1->>'recordKind','quantity','tied quantity event follows the asset without duplication') from overview_snapshot;
select is((select sum((p->>'value')::integer)::integer from jsonb_array_elements(value->'activity'->'points') p),6,
 'activity counts base events once, including metadata/clear/restore, without assignment duplication') from overview_snapshot;
select is(value->'stockTrends'->0->>'coverage','complete','all supported storage event shapes reconstruct') from overview_snapshot;
select is(value->'stockTrends'->0->'points'->0->>'value','12','site-only mutations do not invent storage changes') from overview_snapshot;
select is(value->'stockTrends'->0->'points'->13->>'value','0','archive clear is a real delta; restore does not invent stock') from overview_snapshot;
select is(value->'stockTrends'->2->>'coverage','partial','opening within the window exposes a boundary') from overview_snapshot;
select is(value->'stockTrends'->2->'points'->0->>'state','not_yet_recorded','before creation is explicitly unknown') from overview_snapshot;
select is(value->'stockTrends'->2->'points'->13->>'value','0','site opening establishes zero available storage') from overview_snapshot;
select ok(octet_length(value::text)<=65536,'fixed output stays within 64 KiB') from overview_snapshot;
reset role;

-- Historical custody remains readable at the already inactive topology.
set local role authenticated;
select ok((select bool_and((r->>'siteActive')::boolean=false)
 from jsonb_array_elements(public.overview_snapshot_v1()->'atSites'->'rows') r),
 'positive custody at inactive sites is explicitly labeled rather than hidden');
select is(public.overview_snapshot_v1()->'atSites'->>'occupiedSites','1',
 'deactivation does not erase recorded site custody');
reset role;

-- Normal RPC behavior supplies the exact at-threshold case. A historical
-- inactive-location holding is then simulated using privileged fixture SQL;
-- ordinary lifecycle RPCs correctly refuse to deactivate occupied locations.
select set_config('request.jwt.claims',json_build_object('sub',(select id from overview_actors where kind='staff'),'role','authenticated')::text,true);
select public.quantity_create(gen_random_uuid(),jsonb_build_object('name','D at threshold',
 'category_id',(select id from public.categories where code='CABLES'),'initial_quantity',2,
 'initial_location_id',(select id from public.locations where code='ITC-D01'),'reorder_threshold',2));
update public.locations set active=false where code='ITC-D02';
update public.stock_balances set location_id=(select id from public.locations where code='ITC-D02')
 where item_id=(select id from public.quantity_items where name='D at threshold');
set local role authenticated;
select is((select row->>'shortfall' from jsonb_array_elements(public.overview_snapshot_v1()->'stock'->'attention') row
 where row->>'name'='D at threshold'),'0','at threshold attention has zero shortfall');
select is((select row->>'available' from jsonb_array_elements(public.overview_snapshot_v1()->'stock'->'attention') row
 where row->>'name'='D at threshold'),'2','inactive-location balances still count as available');
reset role;

-- Missing/gapped/order/endpoint provenance fails closed without fake zeros.
update public.quantity_items set version=2 where id=(select id from overview_items where label='B zero');
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->1->>'reason','event_gap','missing event version is unavailable');
select ok((select bool_and(p->'value'='null'::jsonb) from jsonb_array_elements(public.overview_snapshot_v1()->'stockTrends'->1->'points') p),
 'unknown ledger produces null points');
reset role;
update public.quantity_items set version=1 where id=(select id from overview_items where label='B zero');
insert into public.stock_balances(item_id,location_id,quantity)
 select (select id from overview_items where label='B zero'),id,1 from public.locations where code='ITC-S1C';
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->1->>'reason','current_mismatch','unrecorded endpoint mismatch is unavailable');
reset role;

insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select id,'received',(select id from overview_actors where kind='staff'),'staff',2,now()-interval '29 days'
 from overview_items where label='B zero';
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,1,1,2 from public.quantity_events e cross join public.locations l
 where e.item_id=(select id from overview_items where label='B zero') and e.version=2 and l.code='ITC-S1C';
update public.quantity_items set version=2 where id=(select id from overview_items where label='B zero');
update public.stock_balances set quantity=2 where item_id=(select id from overview_items where label='B zero');
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->1->>'reason','balance_chain','invalid prior balance does not become a reconstructed zero');
reset role;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select id,'metadata_updated',(select id from overview_actors where kind='staff'),'staff',3,now()-interval '31 days'
 from overview_items where label='B zero';
update public.quantity_items set version=3 where id=(select id from overview_items where label='B zero');
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->1->>'reason','event_gap','timestamp reversal never fabricates ordered history');
reset role;
update public.quantity_items set created_at=created_at-interval '1 second' where id=(select id from overview_items where label='B zero');
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->1->>'reason','missing_opening','missing matching opening is unavailable');
reset role;

-- Bounded reconstruction and activity sentinel: exceed both without sending
-- a raw ledger to the client or presenting 10,000 as an exact activity count.
insert into public.quantity_items(name,category_id,reorder_threshold,version,created_at)
 values ('00 budget',(select id from public.categories where code='CABLES'),0,10001,now());
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select i.id,case when n=1 then 'created' else 'metadata_updated' end,
 (select id from overview_actors where kind='staff'),'staff',n,i.created_at
 from public.quantity_items i cross join generate_series(1,10001) n where i.name='00 budget';
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->0->>'reason','ledger_budget','event sentinel stops over-budget reconstruction');
select is(public.overview_snapshot_v1()->'activity'->>'coverage','unavailable','over-budget activity is unavailable');
select ok((select bool_and(p->'value'='null'::jsonb) from jsonb_array_elements(public.overview_snapshot_v1()->'activity'->'points') p),
 'activity sentinel never labels a truncated count as exact');
reset role;

-- Authoritative executor probe: once only the event-overflow definition is
-- featured, an RLS guard raises on every storage-line row access. It is first
-- demonstrated armed, then the real RPC must succeed without touching lines.
update public.site_quantity_holdings set quantity=0 where quantity>0;
update public.quantity_items set archived=true where name<>'00 budget';
create function pg_temp.overview_test_line_read_guard(uuid) returns boolean
language plpgsql volatile set search_path='' as $$
begin raise exception using errcode='P0001',message='overview_test_line_read_not_expected'; end;
$$;
grant execute on function pg_temp.overview_test_line_read_guard(uuid) to authenticated;
alter policy quantity_event_lines_member_read on public.quantity_event_lines
 using(pg_temp.overview_test_line_read_guard(event_id));
set local role authenticated;
select throws_ok($$select delta from public.quantity_event_lines limit 1$$,
 'P0001','overview_test_line_read_not_expected','line-access guard is armed');
select lives_ok($$select public.overview_snapshot_v1()$$,
 'event-budget overflow skips line execution even with an armed RLS guard');
reset role;
alter policy quantity_event_lines_member_read on public.quantity_event_lines
 using(exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active));

-- Exactly 20,001 raw storage lines with only two events and no balance rows:
-- this isolates the line sentinel from the event/current-balance sentinels.
-- Privileged malformed provenance is deliberate; budget denial must precede
-- shape/chain checks rather than sort/reconstruct a truncated overflow subset.
insert into public.locations(code,name,parent_id,kind,can_hold_inventory)
 select 'OVERVIEW-L-'||n,'Overview overflow location '||n,
 (select id from public.locations where code='ITC'),'storage_area',true
 from generate_series(1,20001) n;
insert into public.quantity_items(name,category_id,reorder_threshold,version,created_at)
 values ('01 line budget',(select id from public.categories where code='CABLES'),0,2,now());
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select i.id,v.kind,(select id from overview_actors where kind='staff'),'staff',v.version,i.created_at
 from public.quantity_items i cross join (values (1,'created'),(2,'archived')) v(version,kind)
 where i.name='01 line budget';
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,-1,1,0 from public.quantity_events e
 join public.quantity_items i on i.id=e.item_id cross join public.locations l
 where i.name='01 line budget' and e.version=2 and l.code like 'OVERVIEW-L-%';
set local role authenticated;
select is(public.overview_snapshot_v1()->'stockTrends'->1->>'reason','ledger_budget',
 '20,001 raw lines are rejected before sort/reconstruction');
select ok((select bool_and(p->'value'='null'::jsonb)
 from jsonb_array_elements(public.overview_snapshot_v1()->'stockTrends'->1->'points') p),
 'line sentinel never exposes an overflow subset as historical stock');
reset role;

-- Auth denial precedes even invalid input; inactive/nonmember never sees zeros
-- which could be confused with an authorized empty workspace.
select set_config('request.jwt.claims',json_build_object('sub',(select id from overview_actors where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.overview_snapshot_v1('invalid')$$,'P1001','forbidden','inactive member explicitly denied');
reset role;
select set_config('request.jwt.claims',json_build_object('sub',(select id from overview_actors where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.overview_snapshot_v1()$$,'P1001','forbidden','Auth-only nonmember explicitly denied');
reset role;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
select throws_ok($$select public.overview_snapshot_v1()$$,'P1001','forbidden','missing identity explicitly denied');
reset role;
select * from finish();
rollback;
