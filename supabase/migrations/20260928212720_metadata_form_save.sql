-- Form visibility and one-request publication. Published revision rows remain immutable.
alter table public.form_revision_sections
  add column visible boolean not null default true,
  add column applies_to text[] not null default array['quantity','asset']::text[]
    check (applies_to<@array['quantity','asset']::text[] and cardinality(applies_to)>0);
alter table public.form_revision_controls
  add column visible boolean not null default true,
  add column applies_to text[] not null default array['quantity','asset']::text[]
    check (applies_to<@array['quantity','asset']::text[] and cardinality(applies_to)>0);

-- A review may begin with no server draft. Its entire proposal and original
-- identity are private; only the narrow returned summary is client-visible.
create table private.form_save_reviews (
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.app_members(user_id) on delete restrict,
  category_id uuid not null,
  draft_id uuid,
  draft_version bigint not null check (draft_version>=0),
  published_id uuid not null,
  proposal jsonb not null,
  reference_fingerprint text not null,
  reasons jsonb not null,
  affected_quantity bigint not null,
  affected_assets bigint not null,
  newly_needs_quantity bigint not null,
  newly_needs_assets bigint not null,
  initial_request_id uuid not null,
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  check ((draft_id is null)=(draft_version=0))
);
revoke all on private.form_save_reviews from public,anon,authenticated,service_role;

-- Kept separate from historical revision JSON. The UUIDs are deterministic for
-- one publication so repeated reads return the same safe virtual controls.
create function private.metadata_effective_definition(rev uuid, definition jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=definition; missing jsonb:='[]'::jsonb; name text;
  id uuid; section_id uuid:=md5('metadata-identification:'||rev::text)::uuid;
begin
  if jsonb_typeof(definition)<>'object' or jsonb_typeof(definition->'layout')<>'array' then
    return definition;
  end if;
  foreach name in array array['name','category_id','asset_tag'] loop
    if not exists(select 1 from jsonb_array_elements(definition->'layout') s,
      jsonb_array_elements(coalesce(s->'controls','[]'::jsonb)) c
      where c->>'kind'='builtin' and c->>'builtin'=name) then
      id:=md5('metadata-control:'||rev::text||':'||name)::uuid;
      missing:=missing||jsonb_build_array(jsonb_build_object('id',id,'kind','builtin',
        'builtin',name,'width',12,'applies_to',
        case when name='asset_tag' then jsonb_build_array('asset')
          else jsonb_build_array('quantity','asset') end));
    end if;
  end loop;
  if jsonb_array_length(missing)>0 then
    result:=jsonb_set(result,'{layout}',(result->'layout')||jsonb_build_array(
      jsonb_build_object('id',section_id,'label','Identification',
        'controls',missing)));
  end if;
  return result;
end;
$$;

create or replace function private.metadata_compile_form(rev uuid, category uuid, definition jsonb) returns void
language plpgsql set search_path='' as $$
declare f jsonb; o jsonb; s jsonb; c jsonb; field_uuid uuid; option_uuid uuid;
  parent_uuid uuid; section_uuid uuid; control_uuid uuid; kind text; ordinal integer;
  field_count integer; option_count integer:=0; row_count integer; bad_count integer;
begin
  if jsonb_typeof(definition) is distinct from 'object' then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  if not (definition ?& array['fields','layout']) or
    jsonb_typeof(definition->'fields') is distinct from 'array'
    or jsonb_typeof(definition->'layout') is distinct from 'array' or
    (select count(*) from jsonb_object_keys(definition))<>2 then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  field_count:=jsonb_array_length(definition->'fields');
  if field_count>100 or jsonb_array_length(definition->'layout')>100 then
    raise exception using errcode='P1022',message='form_resource_limit'; end if;
  ordinal:=0;
  for f in select value from jsonb_array_elements(definition->'fields') loop
    if jsonb_typeof(f) is distinct from 'object' or
      jsonb_typeof(f->'applies_to') is distinct from 'array' or
      (f ? 'options' and jsonb_typeof(f->'options') is distinct from 'array') then
      raise exception using errcode='P1021',message='invalid_field'; end if;
    if not (f ?& array['id','type','label','applies_to','required']) or
      exists(select 1 from jsonb_object_keys(f) k where k not in
        ('id','type','label','help','applies_to','required','default','rules','options')) or
      not coalesce((f->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
      or not coalesce((f->>'type') in ('short_text','long_text','integer','decimal','boolean','date','datetime','url',
        'currency','single_select','multi_select','hierarchical_select')
        ,false)
      or jsonb_typeof(f->'label') is distinct from 'string'
      or not coalesce(length(btrim(f->>'label')) between 1 and 200,false)
      or (f ? 'help' and f->'help'<>'null'::jsonb and
        (jsonb_typeof(f->'help')<>'string' or length(f->>'help')>2000))
      or not coalesce(jsonb_array_length(f->'applies_to') between 1 and 2,false)
      or jsonb_typeof(f->'required') is distinct from 'boolean'
      then
      raise exception using errcode='P1021',message='invalid_field'; end if;
    if exists(select 1 from jsonb_array_elements_text(f->'applies_to') x where x not in ('quantity','asset'))
      or (select count(distinct x) from jsonb_array_elements_text(f->'applies_to') x)<>
         jsonb_array_length(f->'applies_to') then
      raise exception using errcode='P1021',message='invalid_applicability'; end if;
    field_uuid:=(f->>'id')::uuid; kind:=f->>'type';
    if exists(select 1 from public.metadata_fields where id=field_uuid and
      (category_id<>category or field_type<>kind)) then
      raise exception using errcode='P1021',message='field_identity_conflict'; end if;
    insert into public.metadata_fields(id,category_id,field_type) values(field_uuid,category,kind)
      on conflict(id) do nothing;
    perform private.metadata_validate_rules(kind,coalesce(f->'rules','{}'::jsonb));
    if kind='currency' and exists(
      select 1 from public.form_revision_fields prior
      join public.category_form_revisions published on published.id=prior.revision_id
      where prior.field_id=field_uuid and published.status='published'
        and (prior.rules->>'currencyCode' is distinct from f->'rules'->>'currencyCode'
          or prior.rules->>'precision' is distinct from f->'rules'->>'precision')
    ) then raise exception using errcode='P1021',message='currency_meaning_requires_new_field_id'; end if;
    insert into public.form_revision_fields(revision_id,field_id,label,help,applies_to,required,
      default_value,rules,sort_order)
      values(rev,field_uuid,btrim(f->>'label'),nullif(f->>'help',''),
        array(select jsonb_array_elements_text(f->'applies_to')),(f->>'required')::boolean,
        f->'default',coalesce(f->'rules','{}'::jsonb),ordinal);
    row_count:=coalesce(jsonb_array_length(f->'options'),0);
    if row_count>1000 or option_count+row_count>5000 then
      raise exception using errcode='P1022',message='option_resource_limit'; end if;
    if kind not in ('single_select','multi_select','hierarchical_select') and row_count>0 then
      raise exception using errcode='P1021',message='options_on_nonselection'; end if;
    option_count:=option_count+row_count;
    for o in select value from jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) loop
      if jsonb_typeof(o) is distinct from 'object' then
        raise exception using errcode='P1021',message='invalid_option'; end if;
      if not (o ?& array['id','label','active']) or
        exists(select 1 from jsonb_object_keys(o) k where k not in
          ('id','label','parent_id','active')) or
        not coalesce((o->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
        or jsonb_typeof(o->'label') is distinct from 'string'
        or not coalesce(length(btrim(o->>'label')) between 1 and 200,false)
        or jsonb_typeof(o->'active') is distinct from 'boolean' or
        (o ? 'parent_id' and o->'parent_id'<>'null'::jsonb and
          not coalesce((o->>'parent_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)) then
        raise exception using errcode='P1021',message='invalid_option'; end if;
      option_uuid:=(o->>'id')::uuid;
      if exists(select 1 from public.metadata_options where id=option_uuid and field_id<>field_uuid) then
        raise exception using errcode='P1021',message='option_identity_conflict'; end if;
      insert into public.metadata_options(id,field_id) values(option_uuid,field_uuid) on conflict(id) do nothing;
      parent_uuid:=nullif(o->>'parent_id','')::uuid;
      insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
        values(rev,field_uuid,option_uuid,parent_uuid,btrim(o->>'label'),(o->>'active')::boolean,
          (select count(*) from public.form_revision_options where revision_id=rev and field_id=field_uuid));
    end loop;
    if kind<>'hierarchical_select' and exists(select 1 from public.form_revision_options
      where revision_id=rev and field_id=field_uuid and parent_option_id is not null) then
      raise exception using errcode='P1021',message='nonhierarchical_parent'; end if;
    -- Every node must reach a root in at most 64 hops; a cycle cannot pass.
    if kind='hierarchical_select' and exists(
      with recursive walk as (
        select option_id,parent_option_id,array[option_id] visited,1 depth
        from public.form_revision_options where revision_id=rev and field_id=field_uuid
        union all
        select w.option_id,p.parent_option_id,w.visited||p.option_id,w.depth+1
        from walk w join public.form_revision_options p on p.revision_id=rev
          and p.field_id=field_uuid and p.option_id=w.parent_option_id
        where w.parent_option_id is not null and w.depth<65 and not p.option_id=any(w.visited)
      )
      select 1 from walk w where w.depth>64 or
        (w.parent_option_id is not null and (w.parent_option_id=any(w.visited)
          or not exists(select 1 from public.form_revision_options p where p.revision_id=rev
            and p.field_id=field_uuid and p.option_id=w.parent_option_id)))
    ) then raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    if f ? 'default' and not private.metadata_value_valid(rev,field_uuid,f->'default') then
      raise exception using errcode='P1021',message='invalid_default'; end if;
    ordinal:=ordinal+1;
  end loop;
  ordinal:=0;
  for s in select value from jsonb_array_elements(definition->'layout') loop
    if jsonb_typeof(s) is distinct from 'object' or
      jsonb_typeof(s->'controls') is distinct from 'array' then
      raise exception using errcode='P1021',message='invalid_section'; end if;
    if not (s ?& array['id','label','controls']) or
      exists(select 1 from jsonb_object_keys(s) k where k not in ('id','label','controls','visible','applies_to')) or
      not coalesce((s->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
      or jsonb_typeof(s->'label') is distinct from 'string'
      or not coalesce(length(btrim(s->>'label')) between 1 and 200,false)
      or coalesce(jsonb_array_length(s->'controls'),0)>200
      or (s ? 'visible' and jsonb_typeof(s->'visible')<>'boolean')
      or (s ? 'applies_to' and (jsonb_typeof(s->'applies_to')<>'array'
        or jsonb_array_length(s->'applies_to') not between 1 and 2)) then
      raise exception using errcode='P1021',message='invalid_section'; end if;
    if s ? 'applies_to' and (exists(select 1 from jsonb_array_elements_text(s->'applies_to') x
        where x not in ('quantity','asset')) or
      (select count(distinct x) from jsonb_array_elements_text(s->'applies_to') x)<>
        jsonb_array_length(s->'applies_to')) then
      raise exception using errcode='P1021',message='invalid_applicability'; end if;
    section_uuid:=(s->>'id')::uuid;
    insert into public.form_revision_sections(revision_id,id,label,sort_order,visible,applies_to)
      values(rev,section_uuid,btrim(s->>'label'),ordinal,
        coalesce((s->>'visible')::boolean,true),
        case when s ? 'applies_to' then array(select jsonb_array_elements_text(s->'applies_to'))
          else array['quantity','asset']::text[] end);
    row_count:=0;
    for c in select value from jsonb_array_elements(s->'controls') loop
      if jsonb_typeof(c) is distinct from 'object' then
        raise exception using errcode='P1021',message='invalid_control'; end if;
      if not (c ?& array['id','kind','width']) or
        exists(select 1 from jsonb_object_keys(c) k where k not in
          ('id','kind','field_id','builtin','help','width','visible','applies_to')) or
        not coalesce((c->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false)
        or not coalesce(c->>'kind' in ('field','builtin','help'),false)
        or not ((jsonb_typeof(c->'width')='string' and c->>'width'='Auto')
          or (jsonb_typeof(c->'width')='number' and c->>'width' ~ '^(3|4|6|8|9|12)$'))
        or (c ? 'visible' and jsonb_typeof(c->'visible')<>'boolean')
        or (c ? 'applies_to' and (jsonb_typeof(c->'applies_to')<>'array'
          or jsonb_array_length(c->'applies_to') not between 1 and 2)) then
        raise exception using errcode='P1021',message='invalid_control'; end if;
      if c ? 'applies_to' and (exists(select 1 from jsonb_array_elements_text(c->'applies_to') x
          where x not in ('quantity','asset')) or
        (select count(distinct x) from jsonb_array_elements_text(c->'applies_to') x)<>
          jsonb_array_length(c->'applies_to')) then
        raise exception using errcode='P1021',message='invalid_applicability'; end if;
      control_uuid:=(c->>'id')::uuid;
      kind:=c->>'kind';
      if (kind='field' and (not (c ? 'field_id') or c ? 'builtin' or c ? 'help')) or
        (kind='builtin' and (not (c ? 'builtin') or c ? 'field_id' or c ? 'help')) or
        (kind='help' and (not (c ? 'help') or c ? 'field_id' or c ? 'builtin')) then
        raise exception using errcode='P1021',message='invalid_control_properties'; end if;
      if kind='field' and (not coalesce((c->>'field_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',false) or
        not exists(select 1 from public.form_revision_fields where revision_id=rev
          and field_id=(c->>'field_id')::uuid)) then
        raise exception using errcode='P1021',message='unknown_layout_field'; end if;
      if kind='builtin' and not coalesce(c->>'builtin' in
        ('name','category_id','description','manufacturer','model','item_code',
         'reorder_threshold','asset_tag','serial_number'),false) then
        raise exception using errcode='P1021',message='unsupported_builtin'; end if;
      if kind='help' and (jsonb_typeof(c->'help')<>'string' or length(c->>'help')>2000) then
        raise exception using errcode='P1021',message='invalid_help'; end if;
      insert into public.form_revision_controls(revision_id,section_id,control_id,kind,field_id,builtin,help,width,sort_order,visible,applies_to)
        values(rev,section_uuid,control_uuid,kind,
          case when kind='field' then (c->>'field_id')::uuid end,
          case when kind='builtin' then c->>'builtin' end,
          case when kind='help' then c->>'help' end,c->>'width',row_count,
          coalesce((c->>'visible')::boolean,true),
          case when c ? 'applies_to' then array(select jsonb_array_elements_text(c->'applies_to'))
            else array['quantity','asset']::text[] end);
      row_count:=row_count+1;
    end loop;
    ordinal:=ordinal+1;
  end loop;
  -- Reachability is evaluated per inherent record kind after every ancestor's
  -- visibility and applicability. A required field cannot exist only in a
  -- hidden or wrong-kind section. Protected controls must remain reachable.
  if exists(
    select 1 from (values('quantity'::text,'name'::text),('asset','name'),
      ('quantity','category_id'),('asset','category_id'),('asset','asset_tag')) p(entity_kind,builtin)
    where (select count(*) from public.form_revision_controls c
      join public.form_revision_sections s on s.revision_id=c.revision_id and s.id=c.section_id
      where c.revision_id=rev and c.builtin=p.builtin and c.visible and s.visible
        and p.entity_kind=any(c.applies_to) and p.entity_kind=any(s.applies_to))<>1
  ) or exists(
    select 1 from public.form_revision_fields f, unnest(f.applies_to) entity_kind
    where f.revision_id=rev and f.required and not exists(
      select 1 from public.form_revision_controls c
      join public.form_revision_sections s on s.revision_id=c.revision_id and s.id=c.section_id
      where c.revision_id=rev and c.field_id=f.field_id and c.visible and s.visible
        and entity_kind=any(c.applies_to) and entity_kind=any(s.applies_to))
  ) then raise exception using errcode='P1021',message='required_control_missing'; end if;
exception when unique_violation then
  raise exception using errcode='P1021',message='duplicate_form_identity';
end;
$$;

create function private.metadata_rules_consequential(kind text, before_rules jsonb, after_rules jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare k text; old_value text; new_value text;
begin
  for k in select key from (select jsonb_object_keys(coalesce(before_rules,'{}'::jsonb)) key
    union select jsonb_object_keys(coalesce(after_rules,'{}'::jsonb))) keys loop
    if before_rules->k is not distinct from after_rules->k then continue; end if;
    old_value:=before_rules->>k; new_value:=after_rules->>k;
    if k in ('maxLength','maxSelections') and old_value ~ '^[0-9]+$'
      and new_value ~ '^[0-9]+$' and new_value::numeric>=old_value::numeric then continue; end if;
    if k='minLength' and old_value ~ '^[0-9]+$'
      and new_value ~ '^[0-9]+$' and new_value::numeric<=old_value::numeric then continue; end if;
    if kind in ('integer','decimal') and k='max' and old_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value::numeric>=old_value::numeric then continue; end if;
    if kind in ('integer','decimal') and k='min' and old_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value ~ '^-?[0-9]+(\.[0-9]+)?$'
      and new_value::numeric<=old_value::numeric then continue; end if;
    return true;
  end loop;
  return false;
end;
$$;

create function private.metadata_control_kinds(control jsonb, section jsonb, fields jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:='[]'::jsonb; entity_kind text; field jsonb;
begin
  if coalesce((control->>'visible')::boolean,true)=false or
    coalesce((section->>'visible')::boolean,true)=false then return result; end if;
  if control->>'kind'='field' then
    select value into field from jsonb_array_elements(fields)
      where value->>'id'=control->>'field_id';
    if field is null then return result; end if;
  end if;
  foreach entity_kind in array array['quantity','asset'] loop
    if not exists(select 1 from jsonb_array_elements_text(coalesce(section->'applies_to',
      jsonb_build_array('quantity','asset'))) k where k=entity_kind) or
      not exists(select 1 from jsonb_array_elements_text(coalesce(control->'applies_to',
      jsonb_build_array('quantity','asset'))) k where k=entity_kind) then continue; end if;
    if field is not null and not exists(select 1 from jsonb_array_elements_text(field->'applies_to') k
      where k=entity_kind) then continue; end if;
    if control->>'builtin' in ('asset_tag','serial_number') and entity_kind<>'asset' then continue; end if;
    if control->>'builtin' in ('item_code','reorder_threshold') and entity_kind<>'quantity' then continue; end if;
    result:=result||to_jsonb(entity_kind);
  end loop;
  return result;
end;
$$;

create function private.metadata_form_reasons(before_form jsonb, after_form jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare reasons jsonb:='[]'::jsonb; prior_field jsonb; proposed_field jsonb;
  prior_option jsonb; proposed_option jsonb; prior_section jsonb;
  kinds jsonb; field_id text; proposed_section jsonb; prior_control jsonb;
  proposed_control jsonb; control_kinds jsonb; section_kinds jsonb;
  proposed_kinds jsonb; removed_kinds jsonb;
begin
  if jsonb_typeof(after_form->'fields')<>'array' or
    jsonb_typeof(after_form->'layout')<>'array' then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  for prior_field in select value from jsonb_array_elements(before_form->'fields') loop
    field_id:=prior_field->>'id';
    select value into proposed_field from jsonb_array_elements(after_form->'fields')
      where value->>'id'=field_id;
    kinds:=prior_field->'applies_to';
    if proposed_field is null then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','field_retired',
        'id',field_id,'affected_kinds',kinds));
      continue;
    end if;
    if (prior_field->>'required')='false' and (proposed_field->>'required')='true' then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','required_tightened',
        'id',field_id,'affected_kinds',proposed_field->'applies_to'));
    end if;
    select coalesce(jsonb_agg(k order by k),'[]'::jsonb) into removed_kinds
      from jsonb_array_elements_text(prior_field->'applies_to') k
      where not exists(select 1 from jsonb_array_elements_text(proposed_field->'applies_to') n
        where n=k);
    if jsonb_array_length(removed_kinds)>0 then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','applicability_narrowed',
        'id',field_id,'affected_kinds',removed_kinds));
    end if;
    if private.metadata_rules_consequential(prior_field->>'type',
      prior_field->'rules',proposed_field->'rules') then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','rules_tightened',
        'id',field_id,'affected_kinds',proposed_field->'applies_to'));
    end if;
    for prior_option in select value from jsonb_array_elements(coalesce(prior_field->'options','[]'::jsonb))
      where value->>'active'='true' loop
      select value into proposed_option from jsonb_array_elements(coalesce(proposed_field->'options','[]'::jsonb))
        where value->>'id'=prior_option->>'id';
      if proposed_option is null or proposed_option->>'active'='false' then
        reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','choice_retired',
          'id',prior_option->>'id','field_id',field_id,'affected_kinds',kinds));
      end if;
    end loop;
  end loop;
  for proposed_field in select value from jsonb_array_elements(after_form->'fields') loop
    if proposed_field->>'required'='true' and not exists(
      select 1 from jsonb_array_elements(before_form->'fields') f
      where f->>'id'=proposed_field->>'id') then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','required_tightened',
        'id',proposed_field->>'id','affected_kinds',proposed_field->'applies_to'));
    end if;
  end loop;
  for prior_section in select value from jsonb_array_elements(before_form->'layout') loop
    select value into proposed_section from jsonb_array_elements(after_form->'layout')
      where value->>'id'=prior_section->>'id';
    if jsonb_array_length(coalesce(prior_section->'controls','[]'::jsonb))>0 and
      proposed_section is null then
      section_kinds:='[]'::jsonb;
      for prior_control in select value from jsonb_array_elements(prior_section->'controls') loop
        control_kinds:=private.metadata_control_kinds(prior_control,prior_section,before_form->'fields');
        select coalesce(jsonb_agg(kind order by kind),'[]'::jsonb) into section_kinds
          from (select distinct value kind from jsonb_array_elements(section_kinds||control_kinds)) x;
      end loop;
      reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','section_removed',
        'id',prior_section->>'id','affected_kinds',section_kinds));
    end if;
    -- Compare stable control IDs across the full new layout, including their
    -- destination ancestor. A section-level edit cannot hide a cross-section
    -- applicability loss, and an equivalent move remains nonconsequential.
    if proposed_section is null then continue; end if;
    for prior_control in select value from jsonb_array_elements(prior_section->'controls') loop
      if prior_control->>'kind'='field' and not exists(
        select 1 from jsonb_array_elements(after_form->'fields') f
          where f->>'id'=prior_control->>'field_id') then
        continue; -- field_retired already covers this identity.
      end if;
      control_kinds:=private.metadata_control_kinds(prior_control,prior_section,before_form->'fields');
      select c.value,s.value into proposed_control,proposed_section
        from jsonb_array_elements(after_form->'layout') s
        cross join lateral jsonb_array_elements(s.value->'controls') c
        where c.value->>'id'=prior_control->>'id';
      proposed_kinds:=case when proposed_control is null or
        proposed_control->>'kind' is distinct from prior_control->>'kind' or
        (prior_control->>'kind'='field' and
          proposed_control->>'field_id' is distinct from prior_control->>'field_id') or
        (prior_control->>'kind'='builtin' and
          proposed_control->>'builtin' is distinct from prior_control->>'builtin')
        then '[]'::jsonb
        else private.metadata_control_kinds(proposed_control,proposed_section,after_form->'fields') end;
      select coalesce(jsonb_agg(k),'[]'::jsonb) into removed_kinds
        from jsonb_array_elements_text(control_kinds) k where not exists(
          select 1 from jsonb_array_elements_text(proposed_kinds) n where n=k);
      if jsonb_array_length(removed_kinds)>0 then
        reasons:=reasons||jsonb_build_array(jsonb_build_object('kind','applicability_narrowed',
          'id',prior_control->>'id','affected_kinds',removed_kinds));
      end if;
    end loop;
  end loop;
  return reasons;
end;
$$;

create function public.metadata_form_save(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
<<save_block>>
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected_published uuid; expected_draft uuid; expected_version bigint;
  raw_version text; proposal jsonb; review_token uuid; reviewed private.form_save_reviews%rowtype;
  category_row public.categories%rowtype; draft public.category_form_revisions%rowtype;
  active_revision public.category_form_revisions%rowtype; proposed_id uuid; next_number bigint;
  reasons jsonb; affected_q bigint:=0; affected_a bigint:=0;
  event_q bigint:=0; event_a bigint:=0;
  newly_q bigint:=0; newly_a bigint:=0; event_id uuid; result jsonb;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  confirmed boolean;
begin
  select display_name into actor_name from public.app_members where user_id=actor
    and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_actor_id',
    'expected_published_revision_id','expected_draft_id','expected_draft_version',
    'definition','review_token']);
  if private.inventory_uuid(p_payload,'expected_actor_id') is distinct from actor then
    raise exception using errcode='P1001',message='actor_changed'; end if;
  category_id:=private.inventory_uuid(p_payload,'category_id');
  expected_published:=private.inventory_uuid(p_payload,'expected_published_revision_id');
  if not (p_payload ? 'expected_draft_id') or
    not (jsonb_typeof(p_payload->'expected_draft_id')='null' or
      (jsonb_typeof(p_payload->'expected_draft_id')='string' and
        (p_payload->>'expected_draft_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  expected_draft:=private.inventory_uuid(p_payload,'expected_draft_id',false);
  raw_version:=p_payload->>'expected_draft_version';
  if jsonb_typeof(p_payload->'expected_draft_version')<>'string' or
    not coalesce(raw_version ~ '^(0|[1-9][0-9]{0,18})$',false) or
    raw_version::numeric>9223372036854775807 or
    (expected_draft is null) is distinct from (raw_version='0') then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  expected_version:=raw_version::bigint;
  proposal:=p_payload->'definition';
  if proposal is null or octet_length(proposal::text)>262144 then
    raise exception using errcode='P1022',message='draft_resource_limit'; end if;
  if p_payload ? 'review_token' then
    review_token:=private.inventory_uuid(p_payload,'review_token');
  end if;
  confirmed:=review_token is not null;
  normalized:=jsonb_build_object('category_id',category_id,'expected_actor_id',actor,
    'expected_published_revision_id',expected_published,
    'expected_draft_id',expected_draft,'expected_draft_version',expected_version::text,
    'definition',proposal,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_form_save',normalized);
  if replay is not null then return replay; end if;

  -- Latest catalog helper also acquires the custody placement shared lock.
  perform private.configuration_catalog_lock(true);
  select * into category_row from public.categories where id=category_id for update;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions r
    where r.category_id=save_block.category_id and r.status='draft' for update;
  if category_row.published_form_revision_id is distinct from expected_published or
    (expected_draft is null and found) or
    (expected_draft is not null and (not found or draft.id is distinct from expected_draft
      or draft.draft_version<>expected_version)) then
    raise exception using errcode='P1002',message='stale_form'; end if;
  select * into active_revision from public.category_form_revisions
    where id=category_row.published_form_revision_id;
  for item in select * from public.quantity_items q
    where q.category_id=save_block.category_id order by q.id for update loop
    null;
  end loop;
  for asset in select * from public.serialized_assets a
    where a.category_id=save_block.category_id order by a.id for update loop
    null;
  end loop;

  reasons:=private.metadata_form_reasons(
    private.metadata_effective_definition(active_revision.id,active_revision.draft_definition),
    proposal);
  select count(*) into event_q from public.quantity_items q where q.category_id=save_block.category_id;
  select count(*) into event_a from public.serialized_assets a where a.category_id=save_block.category_id;
  if exists(select 1 from jsonb_array_elements(reasons) r,
      jsonb_array_elements_text(r->'affected_kinds') k where k='quantity') then
    affected_q:=event_q;
  end if;
  if exists(select 1 from jsonb_array_elements(reasons) r,
      jsonb_array_elements_text(r->'affected_kinds') k where k='asset') then
    affected_a:=event_a;
  end if;
  if confirmed then
    select * into reviewed from private.form_save_reviews r
      where r.token=review_token and r.actor_id=actor for update;
    if not found or reviewed.expires_at<=clock_timestamp() or
      reviewed.category_id<>category_id or reviewed.draft_id is distinct from expected_draft or
      reviewed.draft_version<>expected_version or
      reviewed.published_id<>expected_published or reviewed.proposal<>proposal or
      reviewed.reference_fingerprint<>private.metadata_reference_fingerprint(category_id) or
      reviewed.reasons<>reasons then
      raise exception using errcode='P1017',message='stale_form_review'; end if;
    if jsonb_array_length(reasons)=0 then
      raise exception using errcode='P1017',message='stale_form_review'; end if;
  elsif jsonb_array_length(reasons)>0 then
    -- The compiler may insert canonical field/option identities. The sentinel
    -- rolls those writes and the provisional revision back as one subtransaction.
    -- Locks were acquired outside this block and remain held.
    begin
      select coalesce(max(revision_number),0)+1 into next_number
        from public.category_form_revisions r where r.category_id=save_block.category_id;
      proposed_id:=gen_random_uuid();
      insert into public.category_form_revisions(id,category_id,status,revision_number,
        draft_definition,published_at)
        values(proposed_id,category_id,'published',next_number,proposal,now());
      perform private.metadata_compile_form(proposed_id,category_id,proposal);
      select count(*) into newly_q from public.quantity_items q
        where q.category_id=save_block.category_id and not q.needs_metadata
          and private.metadata_needs(proposed_id,'quantity',q.custom_values);
      select count(*) into newly_a from public.serialized_assets a
        where a.category_id=save_block.category_id and not a.needs_metadata
          and private.metadata_needs(proposed_id,'asset',a.custom_values);
      raise exception using errcode='P1098',message='form_review_staged';
    exception when sqlstate 'P1098' then null;
    end;
    insert into private.form_save_reviews(actor_id,category_id,draft_id,draft_version,
      published_id,proposal,reference_fingerprint,reasons,affected_quantity,affected_assets,
      newly_needs_quantity,newly_needs_assets,initial_request_id)
      values(actor,category_id,expected_draft,expected_version,expected_published,
        proposal,private.metadata_reference_fingerprint(category_id),reasons,affected_q,affected_a,
        newly_q,newly_a,p_request_id)
      returning token,expires_at into review_token,reviewed.expires_at;
    result:=jsonb_build_object('status','confirmation_required','changed',false,
      'token',review_token,'expires_at',reviewed.expires_at,'category_id',category_id,
      'expected_published_revision_id',expected_published,'expected_draft_id',expected_draft,
      'expected_draft_version',expected_version::text,'reasons',reasons,
      'affected_quantity',affected_q::text,'affected_assets',affected_a::text,
      'newly_needs_quantity',newly_q::text,'newly_needs_assets',newly_a::text);
    update private.mutation_requests set result=save_block.result where actor_id=actor and request_id=p_request_id;
    return result;
  end if;

  if expected_draft is null then
    select coalesce(max(revision_number),0)+1 into next_number
      from public.category_form_revisions r where r.category_id=save_block.category_id;
    proposed_id:=gen_random_uuid();
    insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
      values(proposed_id,category_id,'draft',next_number,proposal);
  else
    proposed_id:=draft.id;
    next_number:=draft.revision_number;
    update public.category_form_revisions set draft_definition=proposal where id=proposed_id;
  end if;
  perform private.metadata_compile_form(proposed_id,category_id,proposal);
  update public.category_form_revisions set status='published',published_at=now(),published_by=actor
    where id=proposed_id;
  update public.categories set published_form_revision_id=proposed_id,version=version+1
    where id=category_id;
  with computed as materialized (
    select q.id,private.metadata_needs(proposed_id,'quantity',q.custom_values) needed
      from public.quantity_items q where q.category_id=save_block.category_id
  ) update public.quantity_items q set needs_metadata=computed.needed
    from computed where q.id=computed.id and q.needs_metadata is distinct from computed.needed;
  with computed as materialized (
    select a.id,private.metadata_needs(proposed_id,'asset',a.custom_values) needed
      from public.serialized_assets a where a.category_id=save_block.category_id
  ) update public.serialized_assets a set needs_metadata=computed.needed
    from computed where a.id=computed.id and a.needs_metadata is distinct from computed.needed;
  insert into public.form_publication_events(actor_id,actor_name,category_id,revision_id,
    previous_revision_id,affected_quantity,affected_assets)
    values(actor,actor_name,category_id,proposed_id,expected_published,event_q,event_a)
    returning id into event_id;
  result:=jsonb_build_object('status','saved','changed',true,'entity_id',proposed_id,
    'version',next_number::text,'event_id',event_id,'category_id',category_id,
    'published_revision_id',proposed_id);
  update private.mutation_requests set result=save_block.result where actor_id=actor and request_id=p_request_id;
  return result;
end;
$$;

-- Detect features the 299aef4 strict client cannot parse or render. Drafts
-- remain permissive on write, so only recognizable unsupported capabilities
-- are rejected; the original JSON is never rewritten or projected away.
create function private.metadata_legacy_upgrade_required(definition jsonb)
returns boolean language plpgsql stable set search_path='' as $$
declare field jsonb; option jsonb; section jsonb; control jsonb;
begin
  if jsonb_typeof(definition)<>'object' then return false; end if;
  if exists(select 1 from jsonb_object_keys(definition) k where k not in ('fields','layout')) then
    return true; end if;
  if jsonb_typeof(definition->'fields')='array' then
    for field in select value from jsonb_array_elements(definition->'fields') loop
      if jsonb_typeof(field)<>'object' then continue; end if;
      if exists(select 1 from jsonb_object_keys(field) k where k not in
        ('id','type','label','help','applies_to','required','default','rules','options')) or
        field->>'type' not in ('short_text','long_text','integer','decimal','boolean','date',
          'datetime','url','currency','single_select','multi_select','hierarchical_select') then
        return true; end if;
      if jsonb_typeof(field->'options')='array' then
        for option in select value from jsonb_array_elements(field->'options') loop
          if jsonb_typeof(option)='object' and exists(
            select 1 from jsonb_object_keys(option) k where k not in
              ('id','label','parent_id','active')) then return true; end if;
        end loop;
      end if;
    end loop;
  end if;
  if jsonb_typeof(definition->'layout')='array' then
    for section in select value from jsonb_array_elements(definition->'layout') loop
      if jsonb_typeof(section)<>'object' then continue; end if;
      if exists(select 1 from jsonb_object_keys(section) k where k not in
        ('id','label','controls')) then return true; end if;
      if jsonb_typeof(section->'controls')='array' then
        for control in select value from jsonb_array_elements(section->'controls') loop
          if jsonb_typeof(control)<>'object' then continue; end if;
          if exists(select 1 from jsonb_object_keys(control) k where k not in
            ('id','kind','field_id','builtin','help','width')) or
            (control->>'kind'='builtin' and control->>'builtin' not in
              ('name','category_id','description','manufacturer','model',
               'reorder_threshold','asset_tag','serial_number')) then
            return true; end if;
        end loop;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

-- The old RPC returns only immutable, original JSON. It fails closed for a
-- new publication or returned draft that the baseline client cannot handle.
create or replace function public.metadata_form_get(p_category_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); maintainer boolean; current_row public.category_form_revisions%rowtype;
  draft_row public.category_form_revisions%rowtype; current_id uuid;
begin
  select role='staff' and can_manage_configuration into maintainer from public.app_members
    where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  select published_form_revision_id into current_id from public.categories where id=p_category_id;
  if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into current_row from public.category_form_revisions where id=current_id;
  if maintainer then
    select * into draft_row from public.category_form_revisions where category_id=p_category_id and status='draft';
  end if;
  if private.metadata_legacy_upgrade_required(current_row.draft_definition) or
    (draft_row.id is not null and private.metadata_legacy_upgrade_required(draft_row.draft_definition)) then
    raise exception using errcode='P1030',message='client_upgrade_required'; end if;
  return jsonb_build_object('category_id',p_category_id,'published_revision_id',current_id,
    'published_number',current_row.revision_number::text,
    'published_definition',current_row.draft_definition,
    'draft_id',draft_row.id,'draft_version',draft_row.draft_version::text,
    'draft_definition',draft_row.draft_definition);
end;
$$;

create function public.metadata_form_get_v2(p_category_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); maintainer boolean; current_row public.category_form_revisions%rowtype;
  draft_row public.category_form_revisions%rowtype; current_id uuid;
begin
  select role='staff' and can_manage_configuration into maintainer from public.app_members
    where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  select published_form_revision_id into current_id from public.categories where id=p_category_id;
  if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into current_row from public.category_form_revisions where id=current_id;
  if maintainer then
    select * into draft_row from public.category_form_revisions where category_id=p_category_id and status='draft';
  end if;
  return jsonb_build_object('category_id',p_category_id,'published_revision_id',current_id,
    'published_number',current_row.revision_number::text,
    'published_definition',private.metadata_effective_definition(current_id,current_row.draft_definition),
    'draft_id',draft_row.id,'draft_version',draft_row.draft_version::text,
    'draft_definition',draft_row.draft_definition);
end;
$$;

revoke all on function private.metadata_effective_definition(uuid,jsonb),
  private.metadata_rules_consequential(text,jsonb,jsonb),
  private.metadata_control_kinds(jsonb,jsonb,jsonb),
  private.metadata_form_reasons(jsonb,jsonb),
  private.metadata_legacy_upgrade_required(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.metadata_form_save(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.metadata_form_save(uuid,jsonb) to authenticated;
revoke all on function public.metadata_form_get_v2(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.metadata_form_get_v2(uuid) to authenticated;
create or replace function public.metadata_draft_save(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected bigint; expected_draft uuid; expected_published uuid;
  definition jsonb; draft public.category_form_revisions%rowtype;
  next_number bigint; category_row public.categories%rowtype; raw_version text;
  active_definition jsonb; draft_present boolean;
begin
  select display_name into actor_name from public.app_members where user_id=actor
    and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_actor_id',
    'expected_draft_id','expected_draft_version','expected_published_revision_id','definition']);
  if private.inventory_uuid(p_payload,'expected_actor_id') is distinct from actor then
    raise exception using errcode='P1001',message='actor_changed'; end if;
  category_id:=private.inventory_uuid(p_payload,'category_id');
  if not(p_payload ? 'expected_draft_id') or
    not (jsonb_typeof(p_payload->'expected_draft_id')='null' or
      (jsonb_typeof(p_payload->'expected_draft_id')='string' and
        (p_payload->>'expected_draft_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  expected_draft:=private.inventory_uuid(p_payload,'expected_draft_id',false);
  expected_published:=private.inventory_uuid(p_payload,'expected_published_revision_id');
  raw_version:=p_payload->>'expected_draft_version';
  if jsonb_typeof(p_payload->'expected_draft_version') not in ('string','number')
    or not coalesce(raw_version ~ '^(0|[1-9][0-9]{0,18})$',false) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  if raw_version::numeric>9223372036854775807 or
    (jsonb_typeof(p_payload->'expected_draft_version')='number'
      and raw_version::numeric>9007199254740991) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  expected:=raw_version::bigint;
  if (expected_draft is null) is distinct from (expected=0) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  definition:=p_payload->'definition';
  if definition is null or octet_length(definition::text)>262144 then
    raise exception using errcode='P1022',message='draft_resource_limit'; end if;
  normalized:=jsonb_build_object('category_id',category_id,'expected_actor_id',actor,
    'expected_draft_id',expected_draft,'expected_draft_version',expected::text,
    'expected_published_revision_id',expected_published,'definition',definition);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_draft_save',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(false);
  -- Serialize first-draft creation on the category row as well as later saves.
  select * into category_row from public.categories where id=category_id for update;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions r
    where r.category_id=(p_payload->>'category_id')::uuid and r.status='draft' for update;
  draft_present:=found;
  select r.draft_definition into active_definition from public.category_form_revisions r
    where r.id=category_row.published_form_revision_id;
  if private.metadata_legacy_upgrade_required(active_definition) or
    (draft_present and private.metadata_legacy_upgrade_required(draft.draft_definition)) or
    private.metadata_legacy_upgrade_required(definition) then
    raise exception using errcode='P1030',message='client_upgrade_required'; end if;
  if category_row.published_form_revision_id is distinct from expected_published then
    raise exception using errcode='P1002',message='stale_form'; end if;
  if not draft_present then
    if expected_draft is not null or expected<>0 then
      raise exception using errcode='P1002',message='stale_draft'; end if;
    select coalesce(max(revision_number),0)+1 into next_number from public.category_form_revisions r
      where r.category_id=(p_payload->>'category_id')::uuid;
    insert into public.category_form_revisions(category_id,status,revision_number,draft_definition)
      values(category_id,'draft',next_number,definition) returning * into draft;
  else
    if draft.id is distinct from expected_draft or draft.draft_version<>expected then
      raise exception using errcode='P1002',message='stale_draft'; end if;
    update public.category_form_revisions set draft_version=draft_version+1,draft_definition=definition
      where id=draft.id returning * into draft;
  end if;
  replay:=jsonb_build_object('entity_id',draft.id,'version',draft.draft_version::text,
    'draft_id',draft.id,'event_id',null,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;
create or replace function public.metadata_publish(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
<<publish_block>>
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected bigint; expected_draft uuid; expected_published uuid; review_token uuid;
  category_row public.categories%rowtype; draft public.category_form_revisions%rowtype;
  reviewed private.form_impact_reviews%rowtype; event_id uuid;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  active_definition jsonb;
begin
  select display_name into actor_name from public.app_members where user_id=actor
    and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_actor_id',
    'expected_draft_id','expected_draft_version','expected_published_revision_id','review_token']);
  if private.inventory_uuid(p_payload,'expected_actor_id') is distinct from actor then
    raise exception using errcode='P1001',message='actor_changed'; end if;
  category_id:=private.inventory_uuid(p_payload,'category_id');
  expected_draft:=private.inventory_uuid(p_payload,'expected_draft_id');
  expected:=private.configuration_version(p_payload,'expected_draft_version');
  expected_published:=private.inventory_uuid(p_payload,'expected_published_revision_id');
  review_token:=private.inventory_uuid(p_payload,'review_token');
  normalized:=jsonb_build_object('category_id',category_id,'expected_actor_id',actor,
    'expected_draft_id',expected_draft,'expected_draft_version',expected::text,
    'expected_published_revision_id',expected_published,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_publish',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  select * into category_row from public.categories where id=category_id for update;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions r
    where r.category_id=(p_payload->>'category_id')::uuid and r.status='draft' for update;
  select r.draft_definition into active_definition from public.category_form_revisions r
    where r.id=category_row.published_form_revision_id;
  if private.metadata_legacy_upgrade_required(active_definition) or
    (draft.id is not null and private.metadata_legacy_upgrade_required(draft.draft_definition)) then
    raise exception using errcode='P1030',message='client_upgrade_required'; end if;
  if draft.id is distinct from expected_draft or draft.draft_version<>expected or
    category_row.published_form_revision_id is distinct from expected_published then
    raise exception using errcode='P1002',message='stale_form'; end if;
  -- Stock mutations do not take the catalog lock. Lock every referenced row in
  -- UUID order before checking the reviewed fingerprint against committed state.
  for item in select * from public.quantity_items q where q.category_id=publish_block.category_id order by q.id for update loop
    null;
  end loop;
  for asset in select * from public.serialized_assets a where a.category_id=publish_block.category_id order by a.id for update loop
    null;
  end loop;
  select * into reviewed from private.form_impact_reviews where token=review_token and actor_id=actor for update;
  if not found or reviewed.expires_at<=clock_timestamp() or reviewed.category_id<>category_id
    or reviewed.draft_id<>draft.id or reviewed.draft_version<>draft.draft_version
    or reviewed.published_id is distinct from category_row.published_form_revision_id
    or reviewed.reference_fingerprint<>private.metadata_reference_fingerprint(category_id) then
    raise exception using errcode='P1017',message='stale_form_review'; end if;
  perform private.metadata_compile_form(draft.id,category_id,draft.draft_definition);
  update public.category_form_revisions set status='published',published_at=now(),published_by=actor where id=draft.id;
  update public.categories set published_form_revision_id=draft.id,version=version+1 where id=category_id;
  -- All affected rows were locked in UUID order above. Compute each derived
  -- result once and update only changed flags as a set; no business events,
  -- versions, timestamps, values or provenance change.
  with computed as materialized (
    select q.id,private.metadata_needs(draft.id,'quantity',q.custom_values) needed
      from public.quantity_items q where q.category_id=publish_block.category_id
  )
  update public.quantity_items q set needs_metadata=computed.needed
    from computed where q.id=computed.id and q.needs_metadata is distinct from computed.needed;
  with computed as materialized (
    select a.id,private.metadata_needs(draft.id,'asset',a.custom_values) needed
      from public.serialized_assets a where a.category_id=publish_block.category_id
  )
  update public.serialized_assets a set needs_metadata=computed.needed
    from computed where a.id=computed.id and a.needs_metadata is distinct from computed.needed;
  insert into public.form_publication_events(actor_id,actor_name,category_id,revision_id,
    previous_revision_id,affected_quantity,affected_assets)
    values(actor,actor_name,category_id,draft.id,expected_published,
      reviewed.affected_quantity,reviewed.affected_assets) returning id into event_id;
  replay:=jsonb_build_object('entity_id',draft.id,'version',draft.revision_number::text,
    'published_revision_id',draft.id,'event_id',event_id,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;
