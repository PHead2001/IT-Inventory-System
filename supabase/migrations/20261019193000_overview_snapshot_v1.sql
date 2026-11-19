-- Fixed read projection. Limits bound the output and reconstruction work, not
-- the cost of exact current-state aggregates. EXPLAIN/Data API proof is required.
create index quantity_events_overview_ledger on public.quantity_events(item_id,version,created_at);

create function public.overview_snapshot_v1(p_time_zone text default 'UTC')
returns jsonb language plpgsql stable security invoker
set search_path='' set statement_timeout='5s' as $$
declare result jsonb; captured_at timestamptz:=statement_timestamp();
begin
 -- Denial precedes input validation: an Auth account alone is not membership.
 if auth.uid() is null or not exists(select 1 from public.app_members m
   where m.user_id=auth.uid() and m.active) then
  raise exception using errcode='P1001',message='forbidden';
 end if;
 if p_time_zone is null or length(p_time_zone)>100
   or not (p_time_zone='UTC' or p_time_zone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+.-]+)+$')
   or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_time_zone) then
  raise exception using errcode='P1012',message='invalid_time_zone';
 end if;
 -- All sections, including the ledger/current-balance reconciliation, share
 -- this one statement snapshot. Calendar boundaries are not 24-hour bins.
 with days as materialized (
  select d::date as day,least((d+interval '1 day') at time zone p_time_zone,captured_at) as endpoint
  from pg_catalog.generate_series(((captured_at at time zone p_time_zone)::date-13)::timestamp,
   ((captured_at at time zone p_time_zone)::date)::timestamp,interval '1 day') d
 ), items as materialized (
  select i.id,i.name,i.version,i.created_at,i.reorder_threshold,
   coalesce((select sum(b.quantity::bigint) from public.stock_balances b where b.item_id=i.id),0) as available
  from public.quantity_items i where not i.archived
 ), ranked as materialized (
  select *,case when reorder_threshold is not null and available<=reorder_threshold then 0
   when reorder_threshold is not null then 1 else 2 end as priority from items
 ), featured as materialized (
  select * from ranked order by priority,lower(name),id limit 3
 ), events as materialized (
  select f.id as item_id,e.* from featured f cross join lateral (
   select q.id as event_id,q.kind,q.version,q.created_at from public.quantity_events q
   where q.item_id=f.id order by q.version limit 5001
  ) e
 ), sequenced as materialized (
  select *,row_number() over(partition by item_id order by version) as ordinal,
   lag(created_at) over(partition by item_id order by version) as previous_at from events
 ), line_eligible as materialized (
  -- Stop before touching any storage lines if the event sentinel overflowed.
  select f.id from featured f
  where (select count(*) from events e where e.item_id=f.id)<=5000
 ), line_candidates as materialized (
  select f.id as item_id,l.* from line_eligible f cross join lateral (
   select q.event_id,q.version,q.created_at,l.location_id,l.delta,l.before_quantity,l.after_quantity
   from events q cross join lateral (
    -- Keep the correlated event-key lookup below the sentinel LIMIT, rather
    -- than sorting/materializing every line of every bounded event first.
    -- OFFSET 0 retains this lateral boundary against subquery pull-up.
    select s.location_id,s.delta,s.before_quantity,s.after_quantity
    from public.quantity_event_lines s where s.event_id=q.event_id offset 0
   ) l
   where q.item_id=f.id limit 20001
  ) l
 ), line_counts as materialized (
  select item_id,count(*) as n from line_candidates group by item_id
 ), lines as materialized (
  -- An overflow subset need not be deterministic: none of it is reconstructed.
  -- Only complete, under-budget candidates are sorted and checked for chains.
  select c.* from line_candidates c join line_counts n using(item_id)
  where n.n<=20000 order by c.item_id,c.version,c.location_id
 ), chains as materialized (
  select *,lag(after_quantity,1,0) over(partition by item_id,location_id order by version) as previous_quantity
  from lines
 ), balances as materialized (
  select f.id as item_id,b.* from featured f cross join lateral (
   select s.location_id,s.quantity from public.stock_balances s where s.item_id=f.id
   order by s.location_id limit 20001
  ) b
 ), event_shapes as materialized (
  select e.item_id,e.event_id,e.kind,e.version,count(l.event_id) as n,
   coalesce(sum(l.delta::bigint),0) as delta,
   coalesce(bool_and(l.delta>0),true) as positive,
   coalesce(bool_and(l.delta<0),true) as negative,
   coalesce(bool_and(l.after_quantity=0),true) as cleared
  from events e left join lines l on l.event_id=e.event_id
  group by e.item_id,e.event_id,e.kind,e.version
 ), ledger_state as materialized (
  select item_id,location_id,sum(delta::bigint) as quantity from lines group by item_id,location_id
 ), reconciled as materialized (
  select coalesce(l.item_id,b.item_id) as item_id,
   bool_and(coalesce(l.quantity,0)=coalesce(b.quantity,0)) as matches
  from ledger_state l full join balances b using(item_id,location_id)
  group by coalesce(l.item_id,b.item_id)
 ), quality as materialized (
  select f.*,case
   when (select count(*) from events e where e.item_id=f.id)>5000
    or coalesce((select n.n from line_counts n where n.item_id=f.id),0)>20000
    or (select count(*) from balances b where b.item_id=f.id)>20000 then 'ledger_budget'
   when not exists(select 1 from events e where e.item_id=f.id and e.version=1
     and e.kind in ('created','site_opened') and e.created_at=f.created_at)
    then 'missing_opening'
   when (select max(e.version) from events e where e.item_id=f.id) is distinct from f.version
    or exists(select 1 from sequenced e where e.item_id=f.id and
     (e.ordinal<>e.version or e.created_at<e.previous_at or e.created_at>captured_at)) then 'event_gap'
   when exists(select 1 from chains l where l.item_id=f.id and
     (l.before_quantity<>l.previous_quantity or l.after_quantity::bigint<>l.before_quantity::bigint+l.delta::bigint))
    then 'balance_chain'
   when exists(select 1 from event_shapes e where e.item_id=f.id and not (
     (e.kind='created' and e.version=1 and e.n<=1 and e.positive)
     or (e.kind='received' and e.n=1 and e.positive)
     or (e.kind='adjusted' and e.n=1)
     or (e.kind='moved' and e.n=2 and e.delta=0)
     or (e.kind='archived' and e.negative and e.cleared)
     or (e.kind='site_issued' and e.n=1 and e.negative)
     or (e.kind='site_returned' and e.n=1 and e.positive)
     or (e.kind in ('metadata_updated','restored','site_opened','site_transferred','site_corrected','site_written_off') and e.n=0)
    )) then 'event_shape'
   when coalesce((select r.matches from reconciled r where r.item_id=f.id),true)=false then 'current_mismatch'
   else null end as reason
  from featured f
 ), trends as materialized (
  select q.id,q.priority,q.name,jsonb_build_object('itemId',q.id,'name',q.name,
   'available',q.available::text,'threshold',q.reorder_threshold::text,
   'coverage',case when q.reason is not null then 'unavailable'
     when exists(select 1 from days d where d.endpoint<=q.created_at) then 'partial' else 'complete' end,
   'reason',q.reason,'points',(select jsonb_agg(jsonb_build_object('date',d.day,
     'at',d.endpoint,'value',case when q.reason is not null or d.endpoint<=q.created_at then null
      else coalesce((select sum(l.delta::bigint) from lines l where l.item_id=q.id and
       (l.created_at<d.endpoint or (d.endpoint=captured_at and l.created_at<=captured_at))),0)::text end,
     'state',case when q.reason is not null then 'unavailable'
      when d.endpoint<=q.created_at then 'not_yet_recorded' else 'recorded' end) order by d.day) from days d)) as projection
  from quality q
 ), recent_quantity as materialized (
  select e.id as event_id,'quantity'::text as record_kind,e.item_id as entity_id,e.kind,e.created_at,e.actor_name,i.name
  from (select * from public.quantity_events order by created_at desc,id asc limit 10) e
  join public.quantity_items i on i.id=e.item_id
 ), recent_assets as materialized (
  select e.id as event_id,'asset'::text as record_kind,e.asset_id as entity_id,e.kind,e.created_at,e.actor_name,a.name
  from (select * from public.asset_events order by created_at desc,id asc limit 10) e
  join public.serialized_assets a on a.id=e.asset_id
 ), recent as materialized (
  select * from (select * from recent_quantity union all select * from recent_assets) r
  order by created_at desc,record_kind asc,event_id asc limit 10
 ), activity_quantity as materialized (
  select created_at from public.quantity_events
  where created_at>=((captured_at at time zone p_time_zone)::date-13)::timestamp at time zone p_time_zone
   and created_at<=captured_at order by created_at,id limit 10001
 ), activity_assets as materialized (
  select created_at from public.asset_events
  where created_at>=((captured_at at time zone p_time_zone)::date-13)::timestamp at time zone p_time_zone
   and created_at<=captured_at order by created_at,id limit 10001
 ), activity as materialized (
  select created_at from (select * from activity_quantity union all select * from activity_assets) a limit 10001
 ), holdings as materialized (
  select a.site_id,a.id as entity_id,'asset'::text as kind,a.name,'1'::text as quantity
  from public.serialized_assets a where a.status='active' and a.site_id is not null
  union all
  select h.site_id,h.item_id,'quantity',i.name,h.quantity::text
  from public.site_quantity_holdings h join public.quantity_items i on i.id=h.item_id
  where h.quantity>0
 )
 select jsonb_build_object('version',1,'asOf',captured_at,'timeZone',p_time_zone,
  'window',jsonb_build_object('startDate',(captured_at at time zone p_time_zone)::date-13,
   'endDate',(captured_at at time zone p_time_zone)::date,'days',14,'todaySoFar',true),
  'stock',jsonb_build_object(
   'monitoredItems',(select count(*)::text from items where reorder_threshold is not null),
   'needsAttention',(select count(*)::text from ranked where priority=0),
   'zeroAvailable',(select count(*)::text from items where reorder_threshold is not null and available=0),
   'unmonitoredItems',(select count(*)::text from items where reorder_threshold is null),
   'attention',coalesce((select jsonb_agg(jsonb_build_object('itemId',id,'name',name,'available',available::text,
    'threshold',reorder_threshold::text,'shortfall',greatest(reorder_threshold::bigint-available,0)::text)
    order by lower(name),id) from (select * from ranked where priority=0 order by lower(name),id limit 5) r),'[]'::jsonb),
   'unmonitored',coalesce((select jsonb_agg(jsonb_build_object('itemId',id,'name',name,'available',available::text)
    order by lower(name),id) from (select * from items where reorder_threshold is null order by lower(name),id limit 5) r),'[]'::jsonb)),
  'atSites',jsonb_build_object('assets',(select count(*)::text from holdings where kind='asset'),
   'quantityDefinitions',(select count(distinct entity_id)::text from holdings where kind='quantity'),
   'occupiedSites',(select count(distinct site_id)::text from holdings),
   'rows',coalesce((select jsonb_agg(jsonb_build_object('siteId',site_id,'siteName',site_name,'siteActive',site_active,
    'entityId',entity_id,'kind',kind,'name',name,'quantity',quantity) order by lower(site_name),site_id,lower(name),kind,entity_id)
    from (select h.*,s.name as site_name,s.active as site_active from holdings h join public.sites s on s.id=h.site_id
     order by lower(s.name),h.site_id,lower(h.name),h.kind,h.entity_id limit 5) r),'[]'::jsonb)),
  'recentEvents',coalesce((select jsonb_agg(jsonb_build_object('eventId',event_id,'recordKind',record_kind,
   'entityId',entity_id,'kind',kind,'name',name,'actorName',actor_name,'at',created_at)
   order by created_at desc,record_kind asc,event_id asc) from recent),'[]'::jsonb),
  'activity',jsonb_build_object('coverage',case when (select count(*) from activity)>10000 then 'unavailable' else 'complete' end,
   'reason',case when (select count(*) from activity)>10000 then 'activity_budget' else null end,
   'points',(select jsonb_agg(jsonb_build_object('date',d.day,'value',case when (select count(*) from activity)>10000 then null
    else (select count(*)::text from activity a where (a.created_at at time zone p_time_zone)::date=d.day) end) order by d.day) from days d)),
  'stockTrends',coalesce((select jsonb_agg(projection order by priority,lower(name),id) from trends),'[]'::jsonb)) into result;
 if octet_length(result::text)>65536 then
  raise exception using errcode='P1012',message='overview_projection_budget';
 end if;
 return result;
end; $$;
revoke all on function public.overview_snapshot_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.overview_snapshot_v1(text) to authenticated;
