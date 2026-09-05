-- Inventory Core: additive state and append-only history; mutations are atomic RPCs.
create table public.quantity_items (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and char_length(name) between 1 and 200),
 description text check(description=btrim(description) and char_length(description) between 1 and 4000),
 category_id uuid not null references public.categories(id) on delete restrict,
 manufacturer text check(manufacturer=btrim(manufacturer) and char_length(manufacturer) between 1 and 200),
 model text check(model=btrim(model) and char_length(model) between 1 and 200),
 archived boolean not null default false,
 version integer not null default 1 check(version>=1),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.stock_balances (
 item_id uuid not null references public.quantity_items(id) on delete restrict,
 location_id uuid not null references public.locations(id) on delete restrict,
 quantity integer not null check(quantity>=0), primary key(item_id,location_id)
);
create index stock_balances_location on public.stock_balances(location_id,item_id) where quantity>0;
create table public.quantity_events (
 id uuid primary key default gen_random_uuid(),
 item_id uuid not null references public.quantity_items(id) on delete restrict,
 kind text not null check(kind in ('created','received','moved','adjusted','metadata_updated','archived','restored')),
 actor_id uuid not null references public.app_members(user_id) on delete restrict, actor_name text not null,
 reason text check(reason=btrim(reason) and char_length(reason) between 1 and 2000),
 before_metadata jsonb, after_metadata jsonb, version integer not null check(version>=1),
 created_at timestamptz not null default now(), unique(item_id,version)
);
create index quantity_events_history on public.quantity_events(created_at desc,id desc);
create table public.quantity_event_lines (
 event_id uuid not null references public.quantity_events(id) on delete restrict,
 location_id uuid not null references public.locations(id) on delete restrict,
 delta integer not null check(delta<>0), before_quantity integer not null check(before_quantity>=0),
 after_quantity integer not null check(after_quantity>=0), primary key(event_id,location_id),
 check(after_quantity::bigint=before_quantity::bigint+delta::bigint)
);
create table public.serialized_assets (
 id uuid primary key default gen_random_uuid(),
 name text not null check(name=btrim(name) and char_length(name) between 1 and 200),
 description text check(description=btrim(description) and char_length(description) between 1 and 4000),
 category_id uuid not null references public.categories(id) on delete restrict,
 manufacturer text check(manufacturer=btrim(manufacturer) and char_length(manufacturer) between 1 and 200),
 model text check(model=btrim(model) and char_length(model) between 1 and 200),
 asset_tag text unique check(asset_tag=lower(btrim(asset_tag)) and char_length(asset_tag) between 1 and 100),
 serial_number text check(serial_number=btrim(serial_number) and char_length(serial_number) between 1 and 200),
 location_id uuid not null references public.locations(id) on delete restrict,
 status text not null default 'active' check(status in ('active','retired')),
 version integer not null default 1 check(version>=1),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index serialized_assets_serial on public.serialized_assets(lower(serial_number)) where serial_number is not null;
create index serialized_assets_location on public.serialized_assets(location_id,status,id);
create index quantity_items_category on public.quantity_items(category_id);
create index serialized_assets_category on public.serialized_assets(category_id);
create table public.asset_events (
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.serialized_assets(id) on delete restrict,
 kind text not null check(kind in ('created','moved','location_corrected','metadata_updated','retired','restored')),
 actor_id uuid not null references public.app_members(user_id) on delete restrict, actor_name text not null,
 reason text check(reason=btrim(reason) and char_length(reason) between 1 and 2000),
 from_location_id uuid references public.locations(id) on delete restrict,
 to_location_id uuid references public.locations(id) on delete restrict,
 before_metadata jsonb, after_metadata jsonb, version integer not null check(version>=1),
 created_at timestamptz not null default now(), unique(asset_id,version)
);
create index asset_events_history on public.asset_events(created_at desc,id desc);
create table private.mutation_requests (
 actor_id uuid not null references public.app_members(user_id) on delete restrict,
 request_id uuid not null, operation text not null,
 request_payload jsonb not null check(jsonb_typeof(request_payload)='object'), result jsonb,
 created_at timestamptz not null default now(), primary key(actor_id,request_id)
);
-- Reservations are private transaction-local work; failures roll back the receipt.
create function private.inventory_append_only() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='42501',message='Inventory history is append-only'; end;
$$;
create trigger quantity_events_append_only before update or delete on public.quantity_events for each row execute function private.inventory_append_only();
create trigger quantity_lines_append_only before update or delete on public.quantity_event_lines for each row execute function private.inventory_append_only();
create trigger asset_events_append_only before update or delete on public.asset_events for each row execute function private.inventory_append_only();

-- Invoker utilities validate scalar inputs and reserve receipts, not mutations.
create function private.inventory_text(p jsonb,k text,max_length integer,required boolean default false)
returns text language plpgsql set search_path='' as $$
declare v text;
begin
 if p->k is not null and p->k<>'null'::jsonb and jsonb_typeof(p->k)<>'string' then
 raise exception using errcode='P1012',message='invalid_input'; end if;
 v:=nullif(regexp_replace(p->>k,'^\s+|\s+$','','g'),'');
 if (required and v is null) or char_length(v)>max_length then
 raise exception using errcode='P1012',message='invalid_input'; end if;
 return v;
end;
$$;
create function private.inventory_uuid(p jsonb,k text,required boolean default true)
returns uuid language plpgsql set search_path='' as $$
begin return private.inventory_text(p,k,36,required)::uuid;
exception when invalid_text_representation then raise exception using errcode='P1012',message='invalid_input';
end;
$$;
create function private.inventory_integer(p jsonb,k text,minimum integer,default_value integer default null)
returns integer language plpgsql set search_path='' as $$
declare v numeric; v_error text:=case when k='expected_version' then 'P1012' else 'P1006' end;
 v_message text:=case when k='expected_version' then 'invalid_input' else 'invalid_quantity' end;
begin
 if not(p ? k) or p->k='null'::jsonb then
 if default_value is not null then return default_value; end if;
 raise exception using errcode=v_error,message=v_message; end if;
 if jsonb_typeof(p->k)<>'number' then raise exception using errcode=v_error,message=v_message; end if;
 v:=(p->>k)::numeric;
 if v<>trunc(v) or v<minimum or v>2147483647 then raise exception using errcode=v_error,message=v_message; end if;
 return v::integer;
end;
$$;
create function private.inventory_payload(p jsonb,keys text[]) returns void
language plpgsql set search_path='' as $$
begin
 if p is null or jsonb_typeof(p)<>'object' then raise exception using errcode='P1012',message='invalid_input'; end if;
 if exists(select 1 from jsonb_object_keys(p) k where not(k=any(keys))) then raise exception using errcode='P1012',message='invalid_input'; end if;
end;
$$;
create function private.inventory_destination(location uuid) returns void
language plpgsql set search_path='' as $$
begin
 perform 1 from public.locations where id=location and active and can_hold_inventory for share;
 if not found then raise exception using errcode='P1004',message='invalid_location'; end if;
end;
$$;
create function private.inventory_category(category uuid,previous uuid default null) returns void
language plpgsql set search_path='' as $$
begin
 perform 1 from public.categories where id=category and (active or id=previous) for share;
 if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
end;
$$;
create function private.inventory_receipt(actor uuid,request uuid,op text,payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare receipt private.mutation_requests%rowtype;
begin
 if request is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 insert into private.mutation_requests(actor_id,request_id,operation,request_payload) values(actor,request,op,payload)
 on conflict(actor_id,request_id) do nothing;
 select * into receipt from private.mutation_requests where actor_id=actor and request_id=request for update;
 if receipt.operation<>op or receipt.request_payload<>payload then raise exception using errcode='P1009',message='idempotency_conflict'; end if;
 return receipt.result;
end;
$$;

create function public.quantity_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model','initial_location_id','initial_quantity']);

 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);

 v_location:=private.inventory_uuid(p_payload,'initial_location_id',false);
 v_quantity:=private.inventory_integer(p_payload,'initial_quantity',0,0);
 if v_quantity>0 and v_location is null then raise exception using errcode='P1012',message='invalid_input'; end if;
 v_payload:=jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'initial_location_id',v_location,'initial_quantity',v_quantity);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_create',v_payload);
 if v_result is not null then return v_result; end if;

 perform private.inventory_category(v_category);
 if v_location is not null then perform private.inventory_destination(v_location); end if;
 insert into public.quantity_items(name,description,category_id,manufacturer,model)
 values(v_name,v_description,v_category,v_manufacturer,v_model) returning id,version into v_id,v_version;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'created',v_actor,v_actor_name,v_reason,null,jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model),v_version);
 if v_quantity>0 then
 insert into public.stock_balances values(v_id,v_location,v_quantity);
 insert into public.quantity_event_lines values(v_event,v_location,v_quantity,0,v_quantity);
 end if;
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_create(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_create(uuid,jsonb) to authenticated;

create function public.quantity_receive(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','location_id','quantity','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_location:=private.inventory_uuid(p_payload,'location_id'); v_quantity:=private.inventory_integer(p_payload,'quantity',1);
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'location_id',v_location,'quantity',v_quantity,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_receive',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
 perform private.inventory_destination(v_location);
 select quantity into v_before from public.stock_balances where item_id=v_id and location_id=v_location;
 v_before:=coalesce(v_before,0); v_after:=v_before::bigint+v_quantity;
 if v_after>2147483647 then raise exception using errcode='P1006',message='invalid_quantity'; end if;
 insert into public.stock_balances values(v_id,v_location,v_after::integer) on conflict(item_id,location_id) do update set quantity=excluded.quantity;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'received',v_actor,v_actor_name,v_reason,null,null,v_version);
 insert into public.quantity_event_lines values(v_event,v_location,v_quantity,v_before,v_after::integer);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_receive(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_receive(uuid,jsonb) to authenticated;

create function public.quantity_move(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','source_location_id','destination_location_id','quantity','move_all','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_source:=private.inventory_uuid(p_payload,'source_location_id'); v_destination:=private.inventory_uuid(p_payload,'destination_location_id');
 if p_payload ? 'move_all' and jsonb_typeof(p_payload->'move_all')<>'boolean' then raise exception using errcode='P1012',message='invalid_input'; end if;
 v_move_all:=coalesce((p_payload->>'move_all')::boolean,false);
 if v_move_all then
 if p_payload->'quantity' is not null and p_payload->'quantity'<>'null'::jsonb then raise exception using errcode='P1012',message='invalid_input'; end if;
 else v_quantity:=private.inventory_integer(p_payload,'quantity',1); end if;
 v_reason:=private.inventory_text(p_payload,'reason',2000);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'source_location_id',v_source,'destination_location_id',v_destination,'quantity',v_quantity,'move_all',v_move_all,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_move',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if v_source=v_destination then raise exception using errcode='P1005',message='same_location'; end if;
 perform private.inventory_destination(v_destination);
 select quantity into v_before from public.stock_balances where item_id=v_id and location_id=v_source;
 if coalesce(v_before,0)=0 then raise exception using errcode='P1003',message='insufficient_stock'; end if;
 if v_move_all then v_quantity:=v_before; end if;
 if v_quantity>v_before then raise exception using errcode='P1003',message='insufficient_stock'; end if;
 select quantity into v_delta from public.stock_balances where item_id=v_id and location_id=v_destination;
 v_delta:=coalesce(v_delta,0); v_after:=v_delta::bigint+v_quantity;
 if v_after>2147483647 then raise exception using errcode='P1006',message='invalid_quantity'; end if;
 update public.stock_balances set quantity=quantity-v_quantity where item_id=v_id and location_id=v_source;
 insert into public.stock_balances values(v_id,v_destination,v_after::integer) on conflict(item_id,location_id) do update set quantity=excluded.quantity;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'moved',v_actor,v_actor_name,v_reason,null,null,v_version);
 insert into public.quantity_event_lines values(v_event,v_source,-v_quantity,v_before,v_before-v_quantity),(v_event,v_destination,v_quantity,v_delta,v_after::integer);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_move(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_move(uuid,jsonb) to authenticated;

create function public.quantity_adjust(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','location_id','observed_quantity','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_location:=private.inventory_uuid(p_payload,'location_id'); v_quantity:=private.inventory_integer(p_payload,'observed_quantity',0);
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'location_id',v_location,'observed_quantity',v_quantity,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_adjust',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
 perform private.inventory_destination(v_location);
 select quantity into v_before from public.stock_balances where item_id=v_id and location_id=v_location;
 v_before:=coalesce(v_before,0); v_delta:=v_quantity-v_before;
 if v_delta=0 then v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',null,'changed',false);
 else
 insert into public.stock_balances values(v_id,v_location,v_quantity) on conflict(item_id,location_id) do update set quantity=excluded.quantity;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'adjusted',v_actor,v_actor_name,v_reason,null,null,v_version);
 insert into public.quantity_event_lines values(v_event,v_location,v_delta,v_before,v_quantity);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true); end if;

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_adjust(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_adjust(uuid,jsonb) to authenticated;

create function public.quantity_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','name','description','category_id','manufacturer','model']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);

 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_update',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if; perform private.inventory_category(v_category,v_item.category_id);
 update public.quantity_items set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id; insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,jsonb_build_object('name',v_item.name,'description',v_item.description,'category_id',v_item.category_id,'manufacturer',v_item.manufacturer,'model',v_item.model),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_update(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_update(uuid,jsonb) to authenticated;

create function public.quantity_archive(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_archive',v_payload);
 if v_result is not null then return v_result; end if;

 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;

 if v_item.archived=true then raise exception using errcode='P1008',message='invalid_transition'; end if;
if exists(select 1 from public.stock_balances where item_id=v_id and quantity>0) then raise exception using errcode='P1008',message='invalid_transition'; end if;
 update public.quantity_items set archived=true where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'archived',v_actor,v_actor_name,v_reason,jsonb_build_object('archived',v_item.archived),jsonb_build_object('archived',true),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_archive(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_archive(uuid,jsonb) to authenticated;

create function public.quantity_restore(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['item_id','expected_version','reason']);
 v_id:=private.inventory_uuid(p_payload,'item_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('item_id',v_id,'expected_version',v_version,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'quantity_restore',v_payload);
 if v_result is not null then return v_result; end if;

 select * into v_item from public.quantity_items where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_item.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;

 if v_item.archived=false then raise exception using errcode='P1008',message='invalid_transition'; end if;

 update public.quantity_items set archived=false where id=v_id;
 if v_item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_item.version+1; update public.quantity_items set version=v_version,updated_at=now() where id=v_id;
 insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version) values(v_event,v_id,'restored',v_actor,v_actor_name,v_reason,jsonb_build_object('archived',v_item.archived),jsonb_build_object('archived',false),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.quantity_restore(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.quantity_restore(uuid,jsonb) to authenticated;

create function public.asset_create(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model','asset_tag','serial_number','location_id']);

 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);

 v_tag:=lower(private.inventory_text(p_payload,'asset_tag',100));
 v_serial:=private.inventory_text(p_payload,'serial_number',200);

 v_location:=private.inventory_uuid(p_payload,'location_id');
 v_payload:=jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial,'location_id',v_location);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_create',v_payload);
 if v_result is not null then return v_result; end if;

 perform private.inventory_category(v_category); perform private.inventory_destination(v_location);
 insert into public.serialized_assets(name,description,category_id,manufacturer,model,asset_tag,serial_number,location_id)
 values(v_name,v_description,v_category,v_manufacturer,v_model,v_tag,v_serial,v_location) returning id,version into v_id,v_version;
 insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'created',v_actor,v_actor_name,v_reason,null,v_location,null,jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.asset_create(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_create(uuid,jsonb) to authenticated;

create function public.asset_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','name','description','category_id','manufacturer','model','asset_tag','serial_number']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_name:=private.inventory_text(p_payload,'name',200,true);
 v_description:=private.inventory_text(p_payload,'description',4000);
 v_category:=private.inventory_uuid(p_payload,'category_id');
 v_manufacturer:=private.inventory_text(p_payload,'manufacturer',200);
 v_model:=private.inventory_text(p_payload,'model',200);

 v_tag:=lower(private.inventory_text(p_payload,'asset_tag',100));
 v_serial:=private.inventory_text(p_payload,'serial_number',200);

 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_update',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 perform private.inventory_category(v_category,v_asset.category_id);
 update public.serialized_assets set name=v_name,description=v_description,category_id=v_category,manufacturer=v_manufacturer,model=v_model,asset_tag=v_tag,serial_number=v_serial where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'metadata_updated',v_actor,v_actor_name,v_reason,null,null,jsonb_build_object('name',v_asset.name,'description',v_asset.description,'category_id',v_asset.category_id,'manufacturer',v_asset.manufacturer,'model',v_asset.model,'asset_tag',v_asset.asset_tag,'serial_number',v_asset.serial_number),jsonb_build_object('name',v_name,'description',v_description,'category_id',v_category,'manufacturer',v_manufacturer,'model',v_model,'asset_tag',v_tag,'serial_number',v_serial),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.asset_update(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_update(uuid,jsonb) to authenticated;

create function public.asset_move(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','location_id','reason']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_location:=private.inventory_uuid(p_payload,'location_id'); v_reason:=private.inventory_text(p_payload,'reason',2000,false);
 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'location_id',v_location,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_move',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_asset.status<>'active' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if v_asset.location_id=v_location then raise exception using errcode='P1005',message='same_location'; end if;
 perform private.inventory_destination(v_location);
 update public.serialized_assets set location_id=v_location where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'moved',v_actor,v_actor_name,v_reason,v_asset.location_id,v_location,null,null,v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.asset_move(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_move(uuid,jsonb) to authenticated;

create function public.asset_correct_location(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','location_id','reason']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_location:=private.inventory_uuid(p_payload,'location_id'); v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'location_id',v_location,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_correct_location',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_asset.status<>'active' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 if v_asset.location_id=v_location then raise exception using errcode='P1005',message='same_location'; end if;
 perform private.inventory_destination(v_location);
 update public.serialized_assets set location_id=v_location where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'location_corrected',v_actor,v_actor_name,v_reason,v_asset.location_id,v_location,null,null,v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.asset_correct_location(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_correct_location(uuid,jsonb) to authenticated;

create function public.asset_retire(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','reason']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_retire',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;
 if v_asset.status<>'active' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 update public.serialized_assets set status='retired' where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'retired',v_actor,v_actor_name,v_reason,v_asset.location_id,v_asset.location_id,jsonb_build_object('status','active'),jsonb_build_object('status','retired'),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.asset_retire(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_retire(uuid,jsonb) to authenticated;

create function public.asset_restore(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 v_actor uuid; v_actor_name text; v_payload jsonb; v_result jsonb;
 v_id uuid; v_version integer; v_event uuid:=gen_random_uuid();
 v_name text; v_description text; v_category uuid; v_manufacturer text; v_model text;
 v_reason text; v_location uuid; v_source uuid; v_destination uuid;
 v_quantity integer; v_before integer; v_after bigint; v_delta integer; v_move_all boolean;
 v_tag text; v_serial text;
 v_item public.quantity_items%rowtype; v_asset public.serialized_assets%rowtype;
begin
 v_actor:=auth.uid();
 if v_actor is null then raise exception using errcode='P1001',message='forbidden'; end if;
 select display_name into v_actor_name from public.app_members
 where user_id=v_actor and active and role='staff' for share;
 if not found then raise exception using errcode='P1001',message='forbidden'; end if;
 perform private.inventory_payload(p_payload,array['asset_id','expected_version','location_id','reason']);
 v_id:=private.inventory_uuid(p_payload,'asset_id'); v_version:=private.inventory_integer(p_payload,'expected_version',1);
 v_location:=private.inventory_uuid(p_payload,'location_id'); v_reason:=private.inventory_text(p_payload,'reason',2000,true);
 v_payload:=jsonb_build_object('asset_id',v_id,'expected_version',v_version,'location_id',v_location,'reason',v_reason);

 v_result:=private.inventory_receipt(v_actor,p_request_id,'asset_restore',v_payload);
 if v_result is not null then return v_result; end if;


 select * into v_asset from public.serialized_assets where id=v_id for update;
 if not found then raise exception using errcode='P1010',message='not_found'; end if;
 if v_asset.version<>v_version then raise exception using errcode='P1002',message='stale_version'; end if;

 if v_asset.status<>'retired' then raise exception using errcode='P1008',message='invalid_transition'; end if;
 perform private.inventory_destination(v_location);
 update public.serialized_assets set status='active',location_id=v_location where id=v_id;
 if v_asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
 v_version:=v_asset.version+1; update public.serialized_assets set version=v_version,updated_at=now() where id=v_id; insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version) values(v_event,v_id,'restored',v_actor,v_actor_name,v_reason,v_asset.location_id,v_location,jsonb_build_object('status','retired'),jsonb_build_object('status','active'),v_version);
 v_result:=jsonb_build_object('entity_id',v_id,'version',v_version,'event_id',v_event,'changed',true);

 update private.mutation_requests set result=v_result where actor_id=v_actor and request_id=p_request_id;
 return v_result;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
revoke all on function public.asset_restore(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.asset_restore(uuid,jsonb) to authenticated;

alter table public.quantity_items enable row level security;
create policy quantity_items_member_read on public.quantity_items for select to authenticated using (
 exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active)
);
revoke all on public.quantity_items from public,anon,authenticated,service_role;
grant select on public.quantity_items to authenticated,service_role;

alter table public.stock_balances enable row level security;
create policy stock_balances_member_read on public.stock_balances for select to authenticated using (
 exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active)
);
revoke all on public.stock_balances from public,anon,authenticated,service_role;
grant select on public.stock_balances to authenticated,service_role;

alter table public.quantity_events enable row level security;
create policy quantity_events_member_read on public.quantity_events for select to authenticated using (
 exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active)
);
revoke all on public.quantity_events from public,anon,authenticated,service_role;
grant select on public.quantity_events to authenticated,service_role;

alter table public.quantity_event_lines enable row level security;
create policy quantity_event_lines_member_read on public.quantity_event_lines for select to authenticated using (
 exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active)
);
revoke all on public.quantity_event_lines from public,anon,authenticated,service_role;
grant select on public.quantity_event_lines to authenticated,service_role;

alter table public.serialized_assets enable row level security;
create policy serialized_assets_member_read on public.serialized_assets for select to authenticated using (
 exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active)
);
revoke all on public.serialized_assets from public,anon,authenticated,service_role;
grant select on public.serialized_assets to authenticated,service_role;

alter table public.asset_events enable row level security;
create policy asset_events_member_read on public.asset_events for select to authenticated using (
 exists(select 1 from public.app_members m where m.user_id=(select auth.uid()) and m.active)
);
revoke all on public.asset_events from public,anon,authenticated,service_role;
grant select on public.asset_events to authenticated,service_role;

revoke all on private.mutation_requests from public,anon,authenticated,service_role;
revoke all on function private.inventory_append_only(), private.inventory_text(jsonb,text,integer,boolean), private.inventory_uuid(jsonb,text,boolean), private.inventory_integer(jsonb,text,integer,integer), private.inventory_payload(jsonb,text[]), private.inventory_destination(uuid), private.inventory_category(uuid,uuid), private.inventory_receipt(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
