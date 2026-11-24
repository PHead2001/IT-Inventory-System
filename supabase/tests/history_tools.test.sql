begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(to_regclass('public.inventory_history_event_keys') is null,'internal key view is not public');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('inventory_history_v2','inventory_history_actors','inventory_history_export_snapshot')),3,'only the three bounded history RPCs are public');
select ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='inventory_history_matching'),'internal matcher is not public');


create temporary table history_actors(kind text primary key,id uuid default gen_random_uuid());
insert into history_actors(kind) values('staff'),('viewer'),('inactive'),('nonmember');
insert into auth.users(id,email) select id,'history-tools-'||kind||'@sql.example.test' from history_actors;
insert into public.app_members(user_id,display_name,role,active)
select id,'Alex',case when kind='staff' then 'staff' else 'viewer' end,kind<>'inactive'
from history_actors where kind<>'nonmember';
grant select on history_actors to authenticated;
create temporary table history_fixture(item uuid,asset uuid,move uuid,site uuid);
insert into history_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on history_fixture to authenticated;
insert into public.quantity_items(id,name,category_id,item_code)
select item,'History literal %_\ current',(select id from public.categories where code='CABLES'),'HISTORY-TOOLS'
from history_fixture;
insert into public.serialized_assets(id,name,category_id,asset_tag,serial_number,location_id)
select asset,'History asset',(select id from public.categories where code='COMPUTERS'),'HISTORY-TOOLS-TAG','History Serial',
 (select id from public.locations where code='ITC-BLACK') from history_fixture;
insert into public.sites(id,code,name) select site,'HISTORY-TOOLS-SITE','History site' from history_fixture;
insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at,before_metadata,after_metadata)
select move,item,'moved',(select id from history_actors where kind='staff'),'Alex',1,'2026-11-01T06:59:59.123456Z',
 '{"name":"History recorded old","item_code":"old-code","custom_values":{"private":"excluded"}}',
 '{"name":"History recorded new","item_code":"new-code"}' from history_fixture;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
select move,l.id,case when l.code='ITC-RED' then -3 else 3 end,
 case when l.code='ITC-RED' then 7 else 0 end,case when l.code='ITC-RED' then 4 else 3 end
from history_fixture cross join public.locations l where l.code in ('ITC-RED','ITC-BLACK');
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
select item,'received',(select id from history_actors where kind='inactive'),'Alex',2,'2026-11-01T06:59:59.123457Z'
from history_fixture;
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at,from_location_id,to_location_id)
select asset,'moved',(select id from history_actors where kind='staff'),'Alex renamed',1,'2026-11-02T06:00:00Z',
 (select id from public.locations where code='ITC-RED'),(select id from public.locations where code='ITC-BLACK')
from history_fixture;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
select item,'site_issued',(select id from history_actors where kind='staff'),'Alex renamed',3,'2026-11-01T07:00:00Z' from history_fixture;
insert into public.assignment_events(quantity_event_id,item_id,kind,actor_id,actor_name,from_location_id,to_site_id,from_label,to_label,quantity,reference)
select e.id,item,'issued',e.actor_id,e.actor_name,(select id from public.locations where code='ITC-RED'),site,
 'Recorded Red','Recorded site',2,'Ticket 42' from history_fixture f join public.quantity_events e on e.item_id=f.item and e.version=3;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
select e.id,l.id,-2,4,2 from history_fixture f join public.quantity_events e on e.item_id=f.item and e.version=3
cross join public.locations l where l.code='ITC-RED';
insert into public.site_quantity_event_lines(event_id,site_id,delta,before_quantity,after_quantity)
select e.id,f.site,2,0,2 from history_fixture f join public.quantity_events e on e.item_id=f.item and e.version=3;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
select item,'site_corrected',(select id from history_actors where kind='staff'),'Alex renamed',4,'2026-11-01T07:10:00Z' from history_fixture;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
select item,'metadata_updated',(select id from history_actors where kind='staff'),'Alex renamed',n,'2026-11-01T08:00:00Z'
from history_fixture cross join generate_series(5,34) n;

select ok(not prosecdef,'history RPC is invoker: '||proname) from pg_proc
where proname in ('inventory_history_v2','inventory_history_matching','inventory_history_actors','inventory_history_export_snapshot');
select ok(not has_function_privilege('anon',oid,'EXECUTE'),'anonymous denied: '||proname) from pg_proc
where proname in ('inventory_history_v2','inventory_history_matching','inventory_history_actors','inventory_history_export_snapshot');
select ok('security_invoker=true'=any(reloptions),'new history relation preserves caller RLS') from pg_class where oid='private.inventory_history_event_keys'::regclass;
select ok('statement_timeout=5s'=any(proconfig),'RPC timeout configured') from pg_proc where oid='public.inventory_history_export_snapshot(text,uuid,text,text,uuid,text,timestamptz,timestamptz)'::regprocedure;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from history_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select is((inventory_history_v2(p_entity_id=>(select item from history_fixture))->>'total')::integer,34,'viewer sees 34 distinct events');
select is(jsonb_array_length(inventory_history_v2(p_entity_id=>(select item from history_fixture))->'rows'),25,'default page has 25 events');
select is(jsonb_array_length(inventory_history_v2(p_entity_id=>(select item from history_fixture),p_page=>2)->'rows'),9,'second page retains remaining events');
select is((inventory_history_v2(p_entity_id=>(select item from history_fixture),p_type=>'asset')->>'total')::integer,0,'impossible record/type scope does not broaden');
select is((inventory_history_v2(p_query=>'%_\')->>'total')::integer,34,'literal wildcard characters do not become SQL patterns');
select is((inventory_history_v2(p_query=>'old-code')->>'total')::integer,1,'recorded identifiers are searchable');
select is((inventory_history_v2(p_query=>'history-tools-tag')->>'total')::integer,1,'current asset tag is searchable');
select is((inventory_history_v2(p_query=>'History Serial')->>'total')::integer,1,'current serial is searchable');
select is((inventory_history_v2(p_actor_id=>(select id from history_actors where kind='inactive'))->>'total')::integer,1,'inactive historical actor remains selectable');
select is((inventory_history_v2(p_entity_id=>(select item from history_fixture),p_event_type=>'movements')->>'total')::integer,2,'movement group includes physical and issue events, excludes corrections and receipts');
select is((inventory_history_v2(p_from=>'2026-11-01T06:59:59.123456Z',p_until=>'2026-11-01T06:59:59.123457Z')->>'total')::integer,1,'date range preserves adjacent microsecond boundaries');
select is((inventory_history_v2(p_type=>'quantity',p_entity_id=>(select item from history_fixture),p_location_code=>'ITC',
 p_query=>'old-code',p_actor_id=>(select id from history_actors where kind='staff'),p_event_type=>'movements',
 p_from=>'2026-11-01T06:59:59.123456Z',p_until=>'2026-11-01T06:59:59.123457Z')->>'total')::integer,1,'all filters apply before counting and pagination');
select is(jsonb_array_length(inventory_history_v2(p_page_size=>100000)->'rows'),35,'page maximum is clamped, preserving event identities');
select is((inventory_history_v2(p_entity_id=>(select item from history_fixture))->'rows'->0->>'id'),
 (select id::text from quantity_events where item_id=(select item from history_fixture) and created_at='2026-11-01T08:00:00Z' order by id limit 1),'ties sort by kind/id deterministically');
select is((inventory_history_actors(p_selected_id=>(select id from history_actors where kind='staff'))->'rows'->0->>'actor_name'),'Alex','historical actor ordering does not depend on membership name');
select ok(exists(select 1 from jsonb_array_elements(inventory_history_actors()->'rows') a where a->>'actor_name'='Alex renamed'),'latest recorded actor name is used');
select is(jsonb_array_length(inventory_history_actors('no match',(select id from history_actors where kind='inactive'))->'rows'),1,'selected actor resolves outside search page');
select is((inventory_history_export_snapshot(p_entity_id=>(select item from history_fixture),p_event_type=>'moved',p_location_code=>'ITC-RED')->>'event_count')::integer,1,'location-matched export counts events once');
select is((inventory_history_export_snapshot(p_entity_id=>(select item from history_fixture),p_event_type=>'moved',p_location_code=>'ITC-RED')->>'row_count')::integer,3,'matched move exports full source and destination lines');
select is(jsonb_array_length(inventory_history_export_snapshot(p_entity_id=>(select item from history_fixture),p_event_type=>'site_issued')->'rows'),3,'custody appears once with storage and site lines');
select is(inventory_history_export_snapshot(p_entity_id=>(select item from history_fixture),p_event_type=>'site_issued')->'rows'->0->>'from_label','Recorded Red','custody exports recorded endpoint labels');
select ok(not (inventory_history_export_snapshot(p_query=>'old-code')::text like '%excluded%'),'export omits arbitrary custom JSON');
select throws_ok($$select inventory_history_v2(p_query=>repeat('x',201))$$,'P1001','invalid_history_filters','oversize direct search rejected');
-- Page, export and the shared matcher reject impossible persisted event/type
-- combinations, rather than presenting a valid-looking empty result.
select throws_ok(format('select %I.%I(p_type=>%L,p_event_type=>%L)',case when rpc='inventory_history_matching' then 'private' else 'public' end,rpc,tracking,event),
 'P1001','invalid_history_filters',rpc||' rejects '||tracking||'/'||event)
from (values ('quantity','location_corrected'),('quantity','retired'),
 ('quantity','site_assigned'),('quantity','site_retired'),('asset','received'),
 ('asset','adjusted'),('asset','archived'),('asset','site_issued')) bad(tracking,event)
cross join (values ('inventory_history_matching'),('inventory_history_v2'),
 ('inventory_history_export_snapshot')) endpoints(rpc);
select lives_ok(format('select public.%I(p_type=>%L,p_event_type=>%L)',rpc,tracking,event),
 rpc||' accepts '||tracking||'/'||event)
from (values ('all'),('quantity'),('asset')) types(tracking)
cross join (values ('all'),('movements'),('site_written_off')) events(event)
cross join (values ('inventory_history_v2'),('inventory_history_export_snapshot')) endpoints(rpc);
select throws_ok($$select inventory_history_v2(p_from=>'2026-10-02T00:00:00Z',p_until=>'2026-10-01T00:00:00Z')$$,'P1001','invalid_history_filters','reversed direct range rejected');
reset role;

-- Duplicate recorded names use independent UUIDs and full-set disambiguation.
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at)
select asset,'metadata_updated',(select id from history_actors where kind='viewer'),'Alex',2,'2026-11-01T09:00:00Z' from history_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from history_actors where kind='staff'),'role','authenticated')::text,true);
set local role authenticated;
select is((inventory_history_actors('Alex')->>'total')::integer,3,'staff sees distinct same-name historical actors including inactive');
select is((select count(*)::integer from jsonb_array_elements(inventory_history_actors('Alex')->'rows') a where (a->>'same_name_count')::integer=2),2,'duplicate names have full-set disambiguation');
select is((inventory_history_v2(p_actor_id=>(select id from history_actors where kind='inactive'))->>'total')::integer,1,'new matching actor does not retarget selected identity');
reset role;

create temporary table history_extra_actors(n integer,id uuid default gen_random_uuid());
insert into history_extra_actors(n) select n from generate_series(1,50) n;
insert into auth.users(id,email) select id,'history-extra-'||n||'@sql.example.test' from history_extra_actors;
insert into public.app_members(user_id,display_name,role,active)
select id,'Directory name deliberately different','viewer',false from history_extra_actors;
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
select f.item,'metadata_updated',a.id,'Historical Person '||lpad(a.n::text,2,'0'),50000+a.n,'2026-01-01T00:00:00Z'
from history_fixture f cross join history_extra_actors a;
set local role authenticated;
select is((inventory_history_actors()->>'total')::integer,53,'actor total includes all historical identities before cap');
select is(jsonb_array_length(inventory_history_actors()->'rows'),50,'actor page is bounded to fifty');
select ok(exists(select 1 from jsonb_array_elements(inventory_history_actors('',(select id from history_actors where kind='inactive'),2)->'rows') a
 where a->>'actor_id'=(select id::text from history_actors where kind='inactive')),'selected actor resolves outside capped page');
select ok(not (inventory_history_actors()::text like '%Directory name deliberately different%'),'options never read current membership directory names');
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from history_actors where kind='inactive'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok('select inventory_history_v2()','42501','history_access_denied','inactive caller sees no events');
select throws_ok('select inventory_history_actors()','42501','history_access_denied','inactive caller sees no actor options');
select throws_ok('select inventory_history_export_snapshot()','42501','history_access_denied','inactive caller exports no rows');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from history_actors where kind='nonmember'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok('select inventory_history_v2()','42501','history_access_denied','nonmember sees no history');
select throws_ok('select inventory_history_actors()','42501','history_access_denied','nonmember sees no actor options');
select throws_ok('select inventory_history_export_snapshot()','42501','history_access_denied','nonmember exports no rows');
reset role;

-- Physical-row overflow is rejected even when event count is under the key cap.
insert into public.quantity_events(item_id,kind,actor_id,actor_name,version,created_at)
select item,'received',(select id from history_actors where kind='staff'),'Overflow',n,
 case when n<=5035 then now() else now()-interval '1 day' end
from history_fixture cross join generate_series(35,10035) n;
insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
select e.id,l.id,1,0,1 from quantity_events e cross join locations l
where e.item_id=(select item from history_fixture) and e.actor_name='Overflow' and l.code='ITC-RED';
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from history_actors where kind='staff'),'role','authenticated')::text,true);
set local role authenticated;
select is(jsonb_array_length(inventory_history_v2(p_entity_id=>(select item from history_fixture),p_page_size=>100000)->'rows'),100,'event pages clamp to 100 before expanding ledger lines');
select throws_ok($$select inventory_history_export_snapshot(p_entity_id=>(select item from history_fixture),p_from=>'2026-01-01T00:00:00Z')$$,'P1013','export_row_limit','10,001 event keys fail bounded export');
select throws_ok($$select inventory_history_export_snapshot(p_entity_id=>(select item from history_fixture),p_event_type=>'received',p_until=>now()+interval '1 minute',p_from=>now()-interval '1 minute')$$,'P1013','export_row_limit','physical ledger rows are capped separately');
reset role;
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at)
select asset,'metadata_updated',(select id from history_actors where kind='staff'),repeat('x',2097152),3,'2099-01-01T00:00:00Z' from history_fixture;
set local role authenticated;
select throws_ok($$select inventory_history_export_snapshot(p_type=>'asset',p_entity_id=>(select asset from history_fixture),p_event_type=>'metadata_updated')$$,'P1025','single_export_event_too_large','one oversized event rejects whole snapshot without truncation');
reset role;

-- Oversized page/person payloads fail explicitly rather than truncating identity.
set local role authenticated;
select throws_ok(format('select inventory_history_v2(p_type=>%L,p_entity_id=>%L::uuid,p_event_type=>%L)',
 'asset',(select asset from history_fixture),'metadata_updated'),'P1025','history_page_too_large','page bounds its complete nested JSON');
select throws_ok($$select inventory_history_actors(p_selected_id=>(select id from history_actors where kind='staff'))$$,'P1025','history_actors_too_large','person rows are byte bounded before array append');

-- Exercise actual complete JSON boundaries, including multibyte/escaped reason,
-- separators, timestamp, counts and envelope. The preappend row-count header uses
-- 10000 conservatively (four extra bytes for this one-row fixture).
reset role;
create temporary table history_byte_fixture(delta integer primary key,asset uuid default gen_random_uuid());
insert into history_byte_fixture(delta) values(-2),(-1),(0),(1);
grant select on history_byte_fixture to authenticated;
insert into public.serialized_assets(id,name,category_id,asset_tag,location_id)
select asset,'Byte fixture',(select id from public.categories where code='COMPUTERS'),'byte-'||asset::text,
 (select id from public.locations where code='ITC-BLACK') from history_byte_fixture;
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at,reason)
select asset,'created',(select id from history_actors where kind='staff'),'Byte actor',1,'2026-11-01T06:59:59.123456Z',E'😀"\\'
from history_byte_fixture where delta=-2;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from history_actors where kind='staff'),'role','authenticated')::text,true);
create temporary table history_byte_size as select octet_length(inventory_history_export_snapshot(p_entity_id=>(select asset from history_byte_fixture where delta=-2))::text) bytes;
reset role;
grant select on history_byte_size to authenticated;
-- Reasons are capped at 2,000 characters, so pad the uncapped actor snapshot instead.
insert into public.asset_events(asset_id,kind,actor_id,actor_name,version,created_at,reason)
select asset,'created',(select id from history_actors where kind='staff'),
 'Byte actor'||repeat('x',2097152-(select bytes from history_byte_size)-4+delta),1,'2026-11-01T06:59:59.123456Z',E'😀"\\'
from history_byte_fixture where delta<>-2;
set local role authenticated;
select lives_ok(format('select inventory_history_export_snapshot(p_entity_id=>%L::uuid)',asset),'complete JSON below/at conservative computed limit '||delta)
from history_byte_fixture where delta in (-1,0);
select throws_ok(format('select inventory_history_export_snapshot(p_entity_id=>%L::uuid)',asset),'P1025','export_byte_limit','one byte above complete computed budget is unavailable')
from history_byte_fixture where delta=1;
select is(octet_length(inventory_history_export_snapshot(p_entity_id=>(select asset from history_byte_fixture where delta=0))::text),2097148,'actual JSON includes envelope and conservative four-byte header margin');

select * from finish();
rollback;
