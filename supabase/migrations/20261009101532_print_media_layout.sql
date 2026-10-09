-- Hardware-neutral media; old receipts retain their exact four-field payload.
create function private.valid_print_layout(v jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare keys text[]; k text; n numeric; lo numeric; hi numeric;
begin
  if v is null then return true; end if;
  if jsonb_typeof(v) is distinct from 'object' then return false; end if;
  if jsonb_typeof(v->'version') is distinct from 'number' then return false; end if;
  if (v->>'version')::numeric <> 1 then return false; end if;
  if v->>'mode' = 'single' then
    keys:=array['version','mode','labelWidth','labelHeight'];
  elsif v->>'mode' = 'sheet' then
    keys:=array['version','mode','labelWidth','labelHeight','sheetWidth','sheetHeight','marginTop','marginRight','marginBottom','marginLeft','gapX','gapY'];
  else return false; end if;
  if not (v ?& keys) or v-keys <> '{}'::jsonb then return false; end if;
  foreach k in array keys loop
    if k in ('version','mode') then continue; end if;
    if jsonb_typeof(v->k) is distinct from 'number' then return false; end if;
    n:=(v->>k)::numeric;
    lo:=case when k='labelWidth' then 380 when k like 'margin%' or k like 'gap%' then 0 else 320 end;
    hi:=case when k like 'margin%' then 500 when k like 'gap%' then 250 else 5000 end;
    -- Bound numeric values before any integer conversion, including huge inputs.
    if n<lo or n>hi or n<>trunc(n) then return false; end if;
  end loop;
  if v->>'mode'='sheet' then
    if (v->>'labelWidth')::integer+(v->>'marginLeft')::integer+(v->>'marginRight')::integer>(v->>'sheetWidth')::integer
      or (v->>'labelHeight')::integer+(v->>'marginTop')::integer+(v->>'marginBottom')::integer>(v->>'sheetHeight')::integer then return false; end if;
  end if;
  return true;
end;
$$;
revoke all on function private.valid_print_layout(jsonb) from public,anon,authenticated,service_role;
alter table public.label_defaults add column layout jsonb;
alter table public.label_defaults add constraint label_defaults_layout_valid check (private.valid_print_layout(layout) is true);
create or replace view public.configuration_label_defaults with (security_invoker=true) as
select size,page,format,version::text as version,updated_at,layout from public.label_defaults where singleton;

create or replace function public.label_defaults_update(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb; event_id uuid;
  expected bigint; selected_size text; selected_page text; selected_format text; selected_layout jsonb;
  supplied_layout boolean; old_row public.label_defaults%rowtype;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['expected_version','size','page','format','layout']);
  expected:=private.configuration_version(p_payload,'expected_version');
  selected_size:=private.inventory_text(p_payload,'size',20,true);
  selected_page:=private.inventory_text(p_payload,'page',20,true);
  selected_format:=private.inventory_text(p_payload,'format',20,true);
  if selected_size not in ('90x50','70x35') or selected_page not in ('letter','A4') or selected_format not in ('qr','code128') then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  supplied_layout:=p_payload ? 'layout';
  selected_layout:=nullif(p_payload->'layout','null'::jsonb);
  if private.valid_print_layout(selected_layout) is not true then raise exception using errcode='P1012',message='invalid_input'; end if;
  normalized:=jsonb_build_object('expected_version',expected::text,'size',selected_size,'page',selected_page,'format',selected_format);
  if supplied_layout then normalized:=normalized||jsonb_build_object('layout',selected_layout); end if;
  replay:=private.inventory_receipt(actor,p_request_id,'label_defaults_update',normalized);
  if replay is not null then return replay; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception using errcode='P1016',message='unsupported_isolation'; end if;
  select * into old_row from public.label_defaults where singleton for update;
  if old_row.version<>expected then raise exception using errcode='P1002',message='stale_version'; end if;
  if not supplied_layout then selected_layout:=old_row.layout; end if;
  if old_row.size=selected_size and old_row.page=selected_page and old_row.format=selected_format and old_row.layout is not distinct from selected_layout then
    replay:=jsonb_build_object('version',old_row.version::text,'event_id',null,'changed',false);
  else
    if old_row.version=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
    update public.label_defaults set size=selected_size,page=selected_page,format=selected_format,layout=selected_layout,
      version=old_row.version+1,updated_at=now() where singleton;
    insert into public.configuration_events(actor_id,actor_name,kind,before_state,after_state)
      values(actor,actor_name,'label_defaults_updated',
        jsonb_build_object('size',old_row.size,'page',old_row.page,'format',old_row.format,'layout',old_row.layout,'version',old_row.version::text),
        jsonb_build_object('size',selected_size,'page',selected_page,'format',selected_format,'layout',selected_layout,'version',(old_row.version+1)::text)) returning id into event_id;
    replay:=jsonb_build_object('version',(old_row.version+1)::text,'event_id',event_id,'changed',true);
  end if;
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;
