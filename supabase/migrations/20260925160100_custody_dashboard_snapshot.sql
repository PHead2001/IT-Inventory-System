-- Keep stock state, threshold, and custody totals in one statement snapshot.
-- The search projection already computes all three from the same item state.
create or replace function public.low_stock_dashboard(
 p_page integer default 1, p_page_size integer default 25
) returns jsonb language sql stable security invoker set search_path='' as $$
 with items as materialized (
  select distinct on (entity_id) entity_id,name,category_name,recorded_total,
   reorder_threshold,stock_state,available_quantity,assigned_quantity,recorded_quantity
  from public.inventory_search_rows
  where kind='quantity' and status='active' and reorder_threshold is not null
  order by entity_id
 ), attention as materialized (
  select * from items where stock_state in ('needs_restocking','out_of_stock')
 ), page as (
  select * from attention order by lower(name),entity_id
  limit greatest(1,least(coalesce(p_page_size,25),100))
  offset (greatest(1,least(coalesce(p_page,1),100000))::bigint-1)
    * greatest(1,least(coalesce(p_page_size,25),100))
 )
 select jsonb_build_object(
  'configured_count',(select count(*) from items),
  'needs_restocking_count',(select count(*) from attention),
  'out_of_stock_count',(select count(*) from attention where stock_state='out_of_stock'),
  'total',(select count(*) from attention),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by lower(p.name),p.entity_id)
   from page p),'[]'::jsonb));
$$;
