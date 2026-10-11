-- Additive read: retain inventory_location_entry_counts and its historical meaning.
create function public.inventory_location_occupancy(p_location_codes text[])
returns table(location_code text, quantity_product_count text, quantity_unit_count text, asset_count text)
language plpgsql stable security invoker
set search_path = '' set statement_timeout = '5s'
as $$
begin
  perform 1 from public.app_members where user_id = auth.uid() and active;
  if not found then
    raise exception using errcode = 'P1001', message = 'forbidden';
  end if;
  if p_location_codes is null or cardinality(p_location_codes) > 100
    or octet_length(to_jsonb(p_location_codes)::text) > 16384
    or exists(select 1 from unnest(p_location_codes) code where code is null or length(code) not between 1 and 100)
    or (select count(distinct code) from unnest(p_location_codes) code) <> cardinality(p_location_codes) then
    raise exception using errcode = 'P1012', message = 'invalid_location_count_request';
  end if;
  return query
  with eligible as materialized (
    select l.id, l.code from public.locations l
    where l.code = any(p_location_codes) and l.active and l.can_hold_inventory
      and not exists(select 1 from public.locations child where child.parent_id = l.id)
  ), quantities as (
    select b.location_id, count(distinct b.item_id) as products, sum(b.quantity) as units
    from public.stock_balances b join eligible l on l.id = b.location_id
      join public.quantity_items q on q.id = b.item_id
    where b.quantity > 0 and not q.archived
    group by b.location_id
  ), assets as (
    select a.location_id, count(*) as assets
    from public.serialized_assets a join eligible l on l.id = a.location_id
    where a.status = 'active' and a.site_id is null
    group by a.location_id
  )
  select l.code, coalesce(q.products, 0)::text, coalesce(q.units, 0)::text, coalesce(a.assets, 0)::text
  from eligible l left join quantities q on q.location_id = l.id
    left join assets a on a.location_id = l.id
  order by l.code;
end;
$$;
revoke all on function public.inventory_location_occupancy(text[]) from public, anon, authenticated, service_role;
grant execute on function public.inventory_location_occupancy(text[]) to authenticated;
