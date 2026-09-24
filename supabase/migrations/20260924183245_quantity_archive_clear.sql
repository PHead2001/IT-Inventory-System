-- Explicit, version-bound stock removal and archive. The old quantity_archive RPC
-- continues to reject positive balances so older clients cannot gain a new
-- destructive behavior just because this migration has been applied.
create function public.quantity_archive_review(p_item_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'item_id',i.id,
  'version',i.version::text,
  'archived',i.archived,
  'removed_total',coalesce(sum(b.quantity::numeric),0)::text,
  'locations',coalesce(jsonb_agg(jsonb_build_object(
    'location_id',l.id,'code',l.code,'breadcrumb',l.breadcrumb,
    'active',l.active,'quantity',b.quantity
   ) order by l.code) filter(where b.quantity>0),'[]'::jsonb)
 )
 from public.quantity_items i
 left join public.stock_balances b on b.item_id=i.id and b.quantity>0
 left join public.inventory_locations l on l.id=b.location_id
 where i.id=p_item_id
 group by i.id;
$$;
revoke all on function public.quantity_archive_review(uuid) from public,anon,authenticated,service_role;
grant execute on function public.quantity_archive_review(uuid) to authenticated;

create function public.quantity_archive_and_clear(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_reason text; v_confirm boolean;
 v_item public.quantity_items%rowtype;
 v_balance record;
 v_total numeric:=0;
 v_deltas jsonb:='[]'::jsonb;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;

 perform private.inventory_payload(p_payload,array['item_id','expected_version','confirm_clear_stock','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id');
 -- The persisted version remains int32 today, but new wire contracts use a
 -- canonical decimal string and never round-trip it through JS Number.
 if jsonb_typeof(p_payload->'expected_version')='string' then
  if (p_payload->>'expected_version') !~ '^[1-9][0-9]*$'
     or length(p_payload->>'expected_version')>10
     or (p_payload->>'expected_version')::numeric>2147483647 then
   raise exception using errcode='P1012',message='invalid_input';
  end if;
  v_version:=(p_payload->>'expected_version')::integer;
 else
  v_version:=private.inventory_integer(p_payload,'expected_version',1);
 end if;
 if p_payload->'confirm_clear_stock' is distinct from 'true'::jsonb then
  raise exception using errcode='P1012',message='invalid_input';
 end if;
 v_confirm:=true;
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version::text,
  'confirm_clear_stock',v_confirm,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_archive_and_clear',v_payload);
 if v_result is not null then return v_result; end if;

 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived or v_item.version=2147483647 then
  raise exception using errcode='P1008',message='invalid_transition';
 end if;

 v_version:=v_item.version+1;
 update public.quantity_items set archived=true,version=v_version,updated_at=now() where id=v_id;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,
  before_metadata,after_metadata,version)
 values(v_event,v_id,'archived',v_actor,v_actor_name,v_reason,
  jsonb_build_object('archived',false),jsonb_build_object('archived',true),v_version);

 -- Ordinary stock mutations serialize on the definition row. Lock each
 -- current positive balance as it is cleared within this transaction.
 for v_balance in
  select location_id,quantity from public.stock_balances
  where item_id=v_id and quantity>0 order by location_id for update
 loop
  v_total:=v_total+v_balance.quantity;
  if v_total>9223372036854775807 then
   raise exception using errcode='P1006',message='invalid_quantity';
  end if;
  update public.stock_balances set quantity=0
   where item_id=v_id and location_id=v_balance.location_id and quantity=v_balance.quantity;
  if not found then raise exception using errcode='P1002',message='stale_version'; end if;
  insert into public.quantity_event_lines(event_id,location_id,delta,before_quantity,after_quantity)
  values(v_event,v_balance.location_id,-v_balance.quantity,v_balance.quantity,0);
  v_deltas:=v_deltas||jsonb_build_array(jsonb_build_object(
   'location_id',v_balance.location_id,'before',v_balance.quantity,
   'delta',-v_balance.quantity,'after',0));
 end loop;

 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version::text,
  'event_id',v_event,'changed',true,'removed_total',v_total::text,
  'location_deltas',v_deltas);
 update private.mutation_requests set result=v_result
  where actor_id=v_actor and request_id=p_request_id;
 return v_result;
end;
$$;
revoke all on function public.quantity_archive_and_clear(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_archive_and_clear(uuid,jsonb) to authenticated;
