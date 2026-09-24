-- Category reassignment changes metadata, not physical asset location.
create or replace function public.category_remove(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  source_id uuid; target_id uuid; review_token uuid; reviewed private.category_impact_reviews%rowtype;
  source_row public.categories%rowtype; target_row public.categories%rowtype;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  current_refs jsonb; historical_refs jsonb; q_count integer:=0; a_count integer:=0; historical boolean; event_id uuid;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','replacement_id','review_token']);
  source_id:=private.inventory_uuid(p_payload,'category_id');
  target_id:=private.inventory_uuid(p_payload,'replacement_id',false);
  review_token:=private.inventory_uuid(p_payload,'review_token');
  if source_id=target_id then raise exception using errcode='P1012',message='invalid_input'; end if;
  normalized:=jsonb_build_object('category_id',source_id,'replacement_id',target_id,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'category_remove',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  -- Category locks precede inventory locks. The order is stable by UUID.
  if target_id is not null and target_id<source_id then
    select * into target_row from public.categories where id=target_id for update;
    select * into source_row from public.categories where id=source_id for update;
  else
    select * into source_row from public.categories where id=source_id for update;
    if target_id is not null then select * into target_row from public.categories where id=target_id for update; end if;
  end if;
  if source_row.id is null or not source_row.active or source_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  if target_id is not null and (target_row.id is null or not target_row.active or target_row.removed_at is not null) then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into reviewed from private.category_impact_reviews where token=review_token and actor_id=actor for update;
  if not found or reviewed.expires_at<=clock_timestamp() or reviewed.source_id<>source_id
    or reviewed.target_id is distinct from target_id or reviewed.source_version<>source_row.version
    or reviewed.target_version is distinct from target_row.version then
    raise exception using errcode='P1017',message='stale_review'; end if;
  current_refs:=private.category_reference_set(source_id);
  if jsonb_array_length(current_refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  -- Lock no more than the capped reference set, then verify it again.
  for item in select * from public.quantity_items where category_id=source_id order by id for update loop
    null;
  end loop;
  for asset in select * from public.serialized_assets where category_id=source_id order by id for update loop
    null;
  end loop;
  current_refs:=private.category_reference_set(source_id);
  if current_refs<>reviewed.reference_set then raise exception using errcode='P1017',message='stale_review'; end if;
  historical_refs:=private.category_historical_reference_counts(source_id);
  if (historical_refs->>'quantity_count')::bigint<>reviewed.historical_quantity_count
    or (historical_refs->>'asset_count')::bigint<>reviewed.historical_asset_count then
    raise exception using errcode='P1017',message='stale_review'; end if;
  if jsonb_array_length(current_refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  if (jsonb_array_length(current_refs)>0 or reviewed.historical_quantity_count>0
    or reviewed.historical_asset_count>0) and target_id is null then
    raise exception using errcode='P1018',message='replacement_required'; end if;
  if target_id is not null then
    for item in select * from public.quantity_items where category_id=source_id order by id loop
      if item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      event_id:=gen_random_uuid();
      update public.quantity_items set category_id=target_id,version=item.version+1,updated_at=now() where id=item.id;
      insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version)
      values(event_id,item.id,'metadata_updated',actor,actor_name,'Category removed: '||source_row.name,
        jsonb_build_object('name',item.name,'description',item.description,'category_id',source_id,'category_name',source_row.name,'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold),
        jsonb_build_object('name',item.name,'description',item.description,'category_id',target_id,'category_name',target_row.name,'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold),item.version+1);
      q_count:=q_count+1;
    end loop;
    for asset in select * from public.serialized_assets where category_id=source_id order by id loop
      if asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      event_id:=gen_random_uuid();
      update public.serialized_assets set category_id=target_id,version=asset.version+1,updated_at=now() where id=asset.id;
      insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version)
      values(event_id,asset.id,'metadata_updated',actor,actor_name,'Category removed: '||source_row.name,
        null,null,
        jsonb_build_object('name',asset.name,'description',asset.description,'category_id',source_id,'category_name',source_row.name,'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,'serial_number',asset.serial_number),
        jsonb_build_object('name',asset.name,'description',asset.description,'category_id',target_id,'category_name',target_row.name,'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,'serial_number',asset.serial_number),asset.version+1);
      a_count:=a_count+1;
    end loop;
  end if;
  select exists(
    select 1 from public.quantity_events e where e.before_metadata->>'category_id'=source_id::text or e.after_metadata->>'category_id'=source_id::text
    union all
    select 1 from public.asset_events e where e.before_metadata->>'category_id'=source_id::text or e.after_metadata->>'category_id'=source_id::text
  ) into historical;
  if historical or q_count+a_count>0 then
    if source_row.version=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
    update public.categories set active=false,removed_at=now(),version=source_row.version+1 where id=source_id;
  else
    delete from public.categories where id=source_id;
  end if;
  insert into public.configuration_events(actor_id,actor_name,kind,category_id,before_state,after_state,affected_quantity,affected_assets)
    values(actor,actor_name,'category_removed',source_id,
      jsonb_build_object('code',source_row.code,'name',source_row.name,'version',source_row.version::text),
      jsonb_build_object('replacement_id',target_id,'tombstoned',historical or q_count+a_count>0),q_count,a_count) returning id into event_id;
  replay:=jsonb_build_object('entity_id',source_id,'category_id',source_id,'version',case when historical or q_count+a_count>0 then (source_row.version+1)::text else null end,
    'event_id',event_id,'changed',true,'quantity_count',q_count::text,'asset_count',a_count::text,
    'historical_quantity_count',reviewed.historical_quantity_count::text,
    'historical_asset_count',reviewed.historical_asset_count::text,
    'tombstoned',historical or q_count+a_count>0);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

-- Historical category-removal metadata events already stored the asset's
-- unchanged location in both columns. Preserve those append-only rows while
-- projecting metadata changes without movement links or location filtering.
create or replace view public.inventory_history_rows with (security_invoker = true) as
select e.id, 'quantity'::text as kind, e.item_id as entity_id,
 i.name as entity_name, e.kind as event_type, e.created_at, e.actor_name, e.reason,
 e.before_metadata, e.after_metadata,
 null::uuid as from_location_id, null::uuid as to_location_id,
 coalesce((select jsonb_agg(jsonb_build_object(
   'location_id', x.location_id, 'delta', x.delta,
   'before_quantity', x.before_quantity, 'after_quantity', x.after_quantity
 ) order by x.location_id) from public.quantity_event_lines x where x.event_id = e.id), '[]'::jsonb) as lines,
 array(select x.location_id from public.quantity_event_lines x where x.event_id = e.id) as location_ids
from public.quantity_events e join public.quantity_items i on i.id = e.item_id
union all
select e.id, 'asset', e.asset_id, a.name, e.kind, e.created_at, e.actor_name, e.reason,
 e.before_metadata, e.after_metadata,
 case when e.kind='metadata_updated' then null::uuid else e.from_location_id end,
 case when e.kind='metadata_updated' then null::uuid else e.to_location_id end,
 '[]'::jsonb,
 case when e.kind='metadata_updated' then '{}'::uuid[]
   else array_remove(array[e.from_location_id, e.to_location_id], null) end
from public.asset_events e join public.serialized_assets a on a.id = e.asset_id;
