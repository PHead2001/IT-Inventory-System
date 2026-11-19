begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- More than ten equal-time events in each stream exercise the source LIMITs,
-- not only the final JSON ordering. History's canonical tie order is kind/UUID ASC.
create temporary table overview_ordering_actor(id uuid default gen_random_uuid());
insert into overview_ordering_actor default values;
insert into auth.users(id,email)
 select id,'overview-ordering@sql.example.test' from overview_ordering_actor;
insert into public.app_members(user_id,display_name,role,active)
 select id,'Ordering viewer','viewer',true from overview_ordering_actor;
create temporary table overview_ordering_item(id uuid default gen_random_uuid());
insert into overview_ordering_item default values;
insert into public.quantity_items(id,name,category_id,version,created_at)
 select id,'Overview tied quantity',(select id from public.categories where code='CABLES'),18,
 now()-interval '3 seconds' from overview_ordering_item;
insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at)
 select ('80000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,i.id,
 case when n=1 then 'created' else 'metadata_updated' end,a.id,'Ordering viewer',n,
 now()-interval '3 seconds'
 from generate_series(1,12) n cross join overview_ordering_item i cross join overview_ordering_actor a;
select set_config('request.jwt.claims',json_build_object('sub',
 (select id from overview_ordering_actor),'role','authenticated')::text,true);
set local role authenticated;
select is(
 (select jsonb_agg(e->>'eventId' order by ordinal) from
  jsonb_array_elements(public.overview_snapshot_v1()->'recentEvents') with ordinality r(e,ordinal)),
 (select jsonb_agg('80000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,10) n),
 'quantity source selects the first ten UUIDs ascending among twelve equal timestamps');
reset role;

create temporary table overview_ordering_asset(id uuid default gen_random_uuid());
insert into overview_ordering_asset default values;
insert into public.serialized_assets(id,name,category_id,location_id,version,created_at)
 select id,'Overview tied asset',(select id from public.categories where code='COMPUTERS'),
 (select id from public.locations where code='ITC-S1A'),18,now()-interval '3 seconds'
 from overview_ordering_asset;
insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,version,created_at)
 select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,i.id,
 case when n=1 then 'created' else 'metadata_updated' end,a.id,'Ordering viewer',n,
 now()-interval '3 seconds'
 from generate_series(1,12) n cross join overview_ordering_asset i cross join overview_ordering_actor a;
set local role authenticated;
select is(
 (select jsonb_agg(e->>'eventId' order by ordinal) from
  jsonb_array_elements(public.overview_snapshot_v1()->'recentEvents') with ordinality r(e,ordinal)),
 (select jsonb_agg('90000000-0000-4000-8000-'||lpad(n::text,12,'0') order by n) from generate_series(1,10) n),
 'asset source selects first ten UUIDs ascending and asset kind wins equal-time cross-stream ties');
reset role;

-- A newer mixed tie group requires six assets then four quantity events. This
-- catches a final LIMIT/aggregate reversal even if each source happens to pass.
insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,version,created_at)
 select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,i.id,
 'metadata_updated',a.id,'Ordering viewer',n+12,now()-interval '1 second'
 from generate_series(1,6) n cross join overview_ordering_item i cross join overview_ordering_actor a;
insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,version,created_at)
 select ('91000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,i.id,
 'metadata_updated',a.id,'Ordering viewer',n+12,now()-interval '1 second'
 from generate_series(1,6) n cross join overview_ordering_asset i cross join overview_ordering_actor a;
set local role authenticated;
select is(
 (select jsonb_agg(e->>'eventId' order by ordinal) from
  jsonb_array_elements(public.overview_snapshot_v1()->'recentEvents') with ordinality r(e,ordinal)),
 (select jsonb_agg(id order by kind,n) from (
   select 'asset' as kind,n,'91000000-0000-4000-8000-'||lpad(n::text,12,'0') as id from generate_series(1,6) n
   union all select 'quantity',n,'81000000-0000-4000-8000-'||lpad(n::text,12,'0') from generate_series(1,4) n
  ) expected),
 'final recent-event LIMIT preserves canonical mixed-stream ordering');
select is(
 (select jsonb_agg(e->>'eventId' order by ordinal) from
  jsonb_array_elements(public.overview_snapshot_v1()->'recentEvents') with ordinality r(e,ordinal)),
 (select jsonb_agg(e->>'id' order by ordinal) from
  jsonb_array_elements(public.inventory_history('all',null,null,1,10)->'rows') with ordinality r(e,ordinal)),
 'Overview recent events agree with the existing History tie order');
reset role;
select * from finish();
rollback;
