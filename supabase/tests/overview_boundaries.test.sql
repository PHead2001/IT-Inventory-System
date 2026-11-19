begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Entirely disposable privileged fixtures; reads use the actual viewer/RLS path.
-- These are bounded set-based histories, not thousands of mutation RPC calls.
create temporary table overview_boundary_actor(id uuid default gen_random_uuid());
insert into overview_boundary_actor default values;
insert into auth.users(id,email)
 select id,'overview-boundaries@sql.example.test' from overview_boundary_actor;
insert into public.app_members(user_id,display_name,role,active)
 select id,'Boundary viewer','viewer',true from overview_boundary_actor;
select set_config('request.jwt.claims',json_build_object('sub',
 (select id from overview_boundary_actor),'role','authenticated')::text,true);

-- Isolate the archive contract from arithmetic/endpoint errors. The partial
-- archive has a valid chain and reconciles to three, but cannot originate from
-- archive-and-clear. Legacy zero-line archive and repeated real clears remain
-- admissible, including a two-location clear followed by restore/replenish.
create temporary table overview_archive_cases(label text,id uuid default gen_random_uuid());
insert into overview_archive_cases(label) values ('Archive partial'),('Archive legacy zero'),('Archive repeated clear');
insert into public.quantity_items(id,name,category_id,reorder_threshold,version,created_at)
 select id,label,(select id from public.categories where code='CABLES'),10,
 case when label='Archive repeated clear' then 7 when label='Archive partial' then 4 else 3 end,now()-interval '30 days'
 from overview_archive_cases;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select c.id,v.kind,(select id from overview_boundary_actor),'Boundary viewer',v.version,i.created_at
 from overview_archive_cases c join public.quantity_items i on i.id=c.id
 cross join (values (1,'created'),(2,'archived'),(3,'restored')) v(version,kind)
 where c.label='Archive legacy zero';
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select c.id,v.kind,(select id from overview_boundary_actor),'Boundary viewer',v.version,i.created_at
 from overview_archive_cases c join public.quantity_items i on i.id=c.id
 cross join (values (1,'created'),(2,'moved'),(3,'archived'),(4,'restored')) v(version,kind)
 where c.label='Archive partial';
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select c.id,v.kind,(select id from overview_boundary_actor),'Boundary viewer',v.version,i.created_at
 from overview_archive_cases c join public.quantity_items i on i.id=c.id
 cross join (values (1,'created'),(2,'moved'),(3,'archived'),(4,'restored'),
 (5,'received'),(6,'archived'),(7,'restored')) v(version,kind)
 where c.label='Archive repeated clear';
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,v.delta,v.before_quantity,v.after_quantity
 from (values ('Archive partial',1,'ITC-S1A',10,0,10),
 ('Archive partial',2,'ITC-S1A',-4,10,6),
 ('Archive partial',2,'ITC-S1B',4,0,4),
 ('Archive partial',3,'ITC-S1A',-6,6,0),
 ('Archive partial',3,'ITC-S1B',-1,4,3),
 ('Archive repeated clear',1,'ITC-S1A',7,0,7),
 ('Archive repeated clear',2,'ITC-S1A',-3,7,4),
 ('Archive repeated clear',2,'ITC-S1B',3,0,3),
 ('Archive repeated clear',3,'ITC-S1A',-4,4,0),
 ('Archive repeated clear',3,'ITC-S1B',-3,3,0),
 ('Archive repeated clear',5,'ITC-S1A',9,0,9),
 ('Archive repeated clear',6,'ITC-S1A',-9,9,0))
 v(label,version,code,delta,before_quantity,after_quantity)
 join overview_archive_cases c on c.label=v.label
 join public.quantity_events e on e.item_id=c.id and e.version=v.version
 join public.locations l on l.code=v.code;
insert into public.stock_balances(item_id,location_id,quantity)
 select c.id,l.id,v.quantity from (values ('Archive partial','ITC-S1A',0),('Archive partial','ITC-S1B',3),
 ('Archive repeated clear','ITC-S1A',0),('Archive repeated clear','ITC-S1B',0)) v(label,code,quantity)
 join overview_archive_cases c on c.label=v.label join public.locations l on l.code=v.code;
set constraints all immediate;
set local role authenticated;
create temporary table overview_archive_snapshot as select public.overview_snapshot_v1() value;
select is(jsonb_array_length(value->'stockTrends'),3,'all archive contract fixtures are featured')
 from overview_archive_snapshot;
select is(t->>'available','3','mixed partial archive current storage still reconciles to three')
 from overview_archive_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name'='Archive partial';
select is(t->>'reason','event_shape','partial archive is refused despite a reconciled chain')
 from overview_archive_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name'='Archive partial';
select ok(t->>'coverage'='unavailable' and (select bool_and(p->'value'='null'::jsonb and p->>'state'='unavailable')
 from jsonb_array_elements(t->'points') p),'partial archive never becomes historical stock')
 from overview_archive_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name'='Archive partial';
select ok(t->>'coverage'='complete' and t->'reason'='null'::jsonb and
 (select bool_and(p->>'value'='0' and p->>'state'='recorded') from jsonb_array_elements(t->'points') p),
 t->>'name'||' preserves all fourteen known zero endpoints')
 from overview_archive_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name' in ('Archive legacy zero','Archive repeated clear');
reset role;
update public.quantity_items set archived=true where id in (select id from overview_archive_cases);

-- Matching opening, consecutive versions, tied ordered timestamps and a real
-- seven-unit opening/current balance: both admitted histories are complete.
create temporary table overview_event_boundaries(n integer,id uuid default gen_random_uuid());
insert into overview_event_boundaries(n) values (4999),(5000),(5001);
insert into public.quantity_items(id,name,category_id,reorder_threshold,version,created_at)
 select id,'Boundary events '||n,(select id from public.categories where code='CABLES'),
 7,n,now()-interval '30 days' from overview_event_boundaries;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select b.id,case when s=1 then 'created' else 'metadata_updated' end,
 (select id from overview_boundary_actor),'Boundary viewer',s,i.created_at
 from overview_event_boundaries b join public.quantity_items i on i.id=b.id
 cross join lateral generate_series(1,b.n) s;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,7,0,7 from overview_event_boundaries b
 join public.quantity_events e on e.item_id=b.id and e.version=1
 cross join public.locations l where l.code='ITC-S1A';
insert into public.stock_balances(item_id,location_id,quantity)
 select b.id,l.id,7 from overview_event_boundaries b
 cross join public.locations l where l.code='ITC-S1A';
set constraints all immediate;
set local role authenticated;
create temporary table overview_event_boundary_snapshot as select public.overview_snapshot_v1() value;
select is(jsonb_array_length(value->'stockTrends'),3,'all three event boundary fixtures are featured')
 from overview_event_boundary_snapshot;
select is(t->>'coverage','complete',t->>'name'||' admits the entire ledger')
 from overview_event_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name' in ('Boundary events 4999','Boundary events 5000');
select ok(t->'reason'='null'::jsonb and
 (select bool_and(p->>'state'='recorded' and p->>'value'='7') from jsonb_array_elements(t->'points') p),
 t->>'name'||' reconstructs all fourteen endpoints and reconciles the current balance')
 from overview_event_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name' in ('Boundary events 4999','Boundary events 5000');
select is(t->>'reason','ledger_budget','5,001 events trip the event sentinel')
 from overview_event_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name'='Boundary events 5001';
select ok((select bool_and(p->'value'='null'::jsonb and p->>'state'='unavailable')
 from jsonb_array_elements(t->'points') p),'event overflow never exposes truncated endpoints')
 from overview_event_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name'='Boundary events 5001';
reset role;
update public.quantity_items set archived=true where id in (select id from overview_event_boundaries);

-- Deliberately malformed partial archives, NOT RPC-origin operational history.
-- Opening + 100 moves = 201 lines. Then 196 partial archives of 101 locations
-- = 19,796 lines, followed by 2/3/4 final archive lines = 19,999/20,000/20,001.
-- Restores follow each archive. All 495 event versions, per-location arithmetic
-- and current balances match. Only the archive shape is malformed. Below/at the
-- raw-line cap must refuse event_shape; above it must refuse ledger_budget first.
-- Valid complete RPC histories with <=5,000 events cannot reach 20,000 lines.
create temporary table overview_line_boundaries(n integer,id uuid default gen_random_uuid());
insert into overview_line_boundaries(n) values (19999),(20000),(20001);
create temporary table overview_boundary_locations(n integer,id uuid default gen_random_uuid());
insert into overview_boundary_locations(n) select generate_series(1,101);
insert into public.locations(code,name,parent_id,kind,can_hold_inventory)
 select 'OVERVIEW-BOUNDARY-'||n,'Boundary location '||n,
 (select id from public.locations where code='ITC'),'storage_area',true
 from overview_boundary_locations;
update overview_boundary_locations b set id=l.id from public.locations l
 where l.code='OVERVIEW-BOUNDARY-'||b.n;
insert into public.quantity_items(id,name,category_id,reorder_threshold,version,created_at)
 select id,'Boundary lines '||n,(select id from public.categories where code='CABLES'),
 1000000,495,now()-interval '30 days' from overview_line_boundaries;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select b.id,v.kind,(select id from overview_boundary_actor),'Boundary viewer',v.version,i.created_at
 from overview_line_boundaries b join public.quantity_items i on i.id=b.id
 cross join (select 1 as version,'created'::text as kind
 union all select n,'moved' from generate_series(2,101) n
 union all select 102+2*(n-1),'archived' from generate_series(1,197) n
 union all select 103+2*(n-1),'restored' from generate_series(1,197) n) v;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,200000,0,200000 from overview_line_boundaries b
 join public.quantity_events e on e.item_id=b.id and e.version=1
 cross join overview_boundary_locations l where l.n=1;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,v.delta,v.before_quantity,v.after_quantity
 from overview_line_boundaries b cross join generate_series(1,100) s
 join public.quantity_events e on e.item_id=b.id and e.version=s+1
 cross join lateral (values (1,-1000,200000-(s-1)*1000,200000-s*1000),
 (s+1,1000,0,1000)) v(location_number,delta,before_quantity,after_quantity)
 join overview_boundary_locations l on l.n=v.location_number;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
 select e.id,l.id,-1,(case when l.n=1 then 100000 else 1000 end)-(s-1),
 (case when l.n=1 then 100000 else 1000 end)-s
 from overview_line_boundaries b cross join generate_series(1,197) s
 join public.quantity_events e on e.item_id=b.id and e.version=102+2*(s-1)
 cross join overview_boundary_locations l where s<=196 or l.n<=b.n-19997;
insert into public.stock_balances(item_id,location_id,quantity)
 select b.id,l.id,(case when l.n=1 then 100000 else 1000 end)-196-
 case when l.n<=b.n-19997 then 1 else 0 end
 from overview_line_boundaries b cross join overview_boundary_locations l;
select is((select count(*)::integer from public.quantity_event_lines l
 join public.quantity_events e on e.id=l.event_id where e.item_id=b.id),b.n,
 b.n||' actual raw lines are present') from overview_line_boundaries b;
select is((select count(*)::integer from public.quantity_events e where e.item_id=b.id),495,
 b.n||' line fixture stays below the event sentinel') from overview_line_boundaries b;
set local role authenticated;
create temporary table overview_line_boundary_snapshot as select public.overview_snapshot_v1() value;
select is(jsonb_array_length(value->'stockTrends'),3,'all three line boundary fixtures are featured')
 from overview_line_boundary_snapshot;
select is(t->>'reason','event_shape',t->>'name'||' reaches provenance checks without budget refusal')
 from overview_line_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name' in ('Boundary lines 19999','Boundary lines 20000');
select is(t->>'reason','ledger_budget','20,001 lines trip the raw-line sentinel')
 from overview_line_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t
 where t->>'name'='Boundary lines 20001';
select ok((select bool_and(p->'value'='null'::jsonb and p->>'state'='unavailable')
 from jsonb_array_elements(t->'points') p),t->>'name'||' never invents a valid history')
 from overview_line_boundary_snapshot cross join lateral jsonb_array_elements(value->'stockTrends') t;
reset role;
update public.quantity_items set archived=true where id in (select id from overview_line_boundaries);

-- Combined base streams: 5,000 quantity + 4,999 asset events. Old fixtures above
-- are outside the activity window. Add one committed-in-transaction event at a
-- time, preserving append-only history and each record's version chain.
create temporary table overview_activity_records(kind text,id uuid default gen_random_uuid());
insert into overview_activity_records(kind) values ('quantity'),('asset');
insert into public.quantity_items(id,name,category_id,reorder_threshold,version,created_at)
 select id,'Boundary activity quantity',(select id from public.categories where code='CABLES'),
 0,5000,now() from overview_activity_records where kind='quantity';
insert into public.serialized_assets(id,name,category_id,location_id,version,created_at)
 select id,'Boundary activity asset',(select id from public.categories where code='COMPUTERS'),
 (select id from public.locations where code='ITC-S1A'),4999,now()
 from overview_activity_records where kind='asset';
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select r.id,case when n=1 then 'created' else 'metadata_updated' end,
 (select id from overview_boundary_actor),'Boundary viewer',n,now()
 from overview_activity_records r cross join generate_series(1,5000) n where r.kind='quantity';
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at)
 select r.id,case when n=1 then 'created' else 'metadata_updated' end,
 (select id from overview_boundary_actor),'Boundary viewer',n,now()
 from overview_activity_records r cross join generate_series(1,4999) n where r.kind='asset';
set constraints all immediate;
set local role authenticated;
create temporary table overview_activity_boundary_snapshots(n integer,value jsonb);
insert into overview_activity_boundary_snapshots values (9999,public.overview_snapshot_v1());
reset role;
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at)
 select id,'metadata_updated',(select id from overview_boundary_actor),'Boundary viewer',5000,now()
 from overview_activity_records where kind='asset';
update public.serialized_assets set version=5000 where id=(select id from overview_activity_records where kind='asset');
set local role authenticated;
insert into overview_activity_boundary_snapshots values (10000,public.overview_snapshot_v1());
select is(value->'activity'->>'coverage','complete',n||' combined events remain exact')
 from overview_activity_boundary_snapshots;
select ok(value->'activity'->'reason'='null'::jsonb and
 (select sum((p->>'value')::integer) from jsonb_array_elements(value->'activity'->'points') p)=n,
 n||' counts both base streams without sentinel truncation') from overview_activity_boundary_snapshots;
reset role;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
 select id,'metadata_updated',(select id from overview_boundary_actor),'Boundary viewer',5001,now()
 from overview_activity_records where kind='quantity';
update public.quantity_items set version=5001 where id=(select id from overview_activity_records where kind='quantity');
set local role authenticated;
insert into overview_activity_boundary_snapshots values (10001,public.overview_snapshot_v1());
select is(value->'activity'->>'coverage','unavailable','10,001 combined events are unavailable')
 from overview_activity_boundary_snapshots where n=10001;
select is(value->'activity'->>'reason','activity_budget','combined overflow reports the activity budget')
 from overview_activity_boundary_snapshots where n=10001;
select ok((select bool_and(p->'value'='null'::jsonb) from jsonb_array_elements(value->'activity'->'points') p),
 'combined overflow never publishes a capped exact total') from overview_activity_boundary_snapshots where n=10001;
reset role;

-- Historical actor snapshots have no table-level length bound. Exercise the
-- projection's defense using privileged metadata, not a claim that current
-- member-name/mutation validation can produce 2,100-character actor names.
-- Ten equally sized ASCII snapshots fit. Ten newer multibyte snapshots have
-- the same character count, and 63,000 actor bytes alone fit, but the complete
-- JSON (including names, IDs, timestamps and other sections) exceeds 65,536.
create temporary table overview_projection_record(id uuid default gen_random_uuid());
insert into overview_projection_record default values;
insert into public.quantity_items(id,name,category_id,reorder_threshold,version,created_at)
 select id,'Boundary projection',(select id from public.categories where code='CABLES'),
 0,10,statement_timestamp() from overview_projection_record;
insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at)
 select ('ffffffff-ffff-4fff-8fff-'||lpad(n::text,12,'0'))::uuid,r.id,
 case when n=1 then 'created' else 'metadata_updated' end,
 (select id from overview_boundary_actor),repeat('x',2100),n,i.created_at
 from overview_projection_record r join public.quantity_items i on i.id=r.id
 cross join generate_series(1,10) n;
set local role authenticated;
create temporary table overview_ascii_projection as select public.overview_snapshot_v1() value;
select is((select count(*)::integer from jsonb_array_elements(value->'recentEvents') e
 where e->>'actorName'=repeat('x',2100)),10,'all ten ASCII metadata snapshots reach the projection')
 from overview_ascii_projection;
select ok(octet_length(value::text)<=65536,'ASCII response with the same metadata character count fits')
 from overview_ascii_projection;
select ok(char_length(value::text)<=65536 and octet_length(value::text)-21000+63000>65536,
 'metadata bytes alone fit; the whole multibyte JSON requires more than 64 KiB') from overview_ascii_projection;
reset role;
insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at)
 select ('ffffffff-ffff-4fff-8fff-'||lpad(n::text,12,'0'))::uuid,r.id,'metadata_updated',
 (select id from overview_boundary_actor),repeat('界',2100),n,i.created_at+interval '1 microsecond'
 from overview_projection_record r join public.quantity_items i on i.id=r.id
 cross join generate_series(11,20) n;
update public.quantity_items set version=20 where id=(select id from overview_projection_record);
set local role authenticated;
select throws_ok($$select public.overview_snapshot_v1()$$,'P1012','overview_projection_budget',
 'UTF-8 bytes plus JSON metadata exceed the cap despite an admitted character count');
reset role;

select * from finish();
rollback;
