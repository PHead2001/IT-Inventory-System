-- U403: publication compatibility uses current persisted provenance; no history rewrite.
create or replace function private.metadata_compile_form(rev uuid, category uuid, definition jsonb) returns void
language plpgsql set search_path='' as $$
declare f jsonb; o jsonb; s jsonb; c jsonb; field_uuid uuid; option_uuid uuid;
  parent_uuid uuid; section_uuid uuid; control_uuid uuid; kind text; ordinal integer;
  field_count integer; option_count integer:=0; row_count integer; bad_count integer; published_baseline jsonb;
begin
  if jsonb_typeof(definition) is distinct from 'object' then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  if not (definition ?& array['fields','layout']) or
    jsonb_typeof(definition->'fields') is distinct from 'array'
    or jsonb_typeof(definition->'layout') is distinct from 'array' or
    (select count(*) from jsonb_object_keys(definition))<>2 then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  -- Publication callers hold the catalog/category locks. Only the current
  -- published pointer establishes provenance; saved drafts and old revisions do not.
  select baseline.draft_definition into published_baseline
    from public.categories current_category
    join public.category_form_revisions baseline
      on baseline.id=current_category.published_form_revision_id and baseline.status='published'
    where current_category.id=category;
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
    -- Every member of a colliding group must be an unchanged active choice
    -- in this exact field in the CURRENT persisted published raw definition.
    -- Compiled labels are btrimmed and cannot establish raw-spelling provenance.
    if exists (
      with active_choices as materialized (
        select value choice,private.metadata_option_label_key(value->>'label') collate "C" label_key
        from jsonb_array_elements(coalesce(f->'options','[]'::jsonb))
        where (value->>'active')::boolean
      ), collisions as (
        select label_key from active_choices group by label_key having count(*)>1
      )
      select 1 from active_choices candidate join collisions using(label_key)
      where not exists (
        select 1 from jsonb_array_elements(coalesce(published_baseline->'fields','[]'::jsonb)) prior_field,
          jsonb_array_elements(coalesce(prior_field->'options','[]'::jsonb)) prior_choice
        where prior_field->>'id'=field_uuid::text
          and prior_choice->>'id'=candidate.choice->>'id'
          and prior_choice->>'active'='true'
          and (prior_choice->>'label' collate "C")=(candidate.choice->>'label' collate "C")
          and prior_choice->>'parent_id' is not distinct from candidate.choice->>'parent_id'
      )
    ) then
      raise exception using errcode='P1021',message='ambiguous_active_field_options',
        detail='Field "'||(f->>'label')||'": active choices need distinguishable labels.';
    end if;
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

create or replace function private.metadata_option_paths(rev uuid, field uuid, selected uuid[]) returns jsonb
language plpgsql stable set search_path='' as $$
declare labels jsonb:='{}'::jsonb; answer uuid; current_id uuid; node jsonb; path text[];
  paths jsonb:='[]'::jsonb; path_json jsonb; path_bytes integer:=2; option_count integer;
  reserved jsonb; used jsonb:='{}'::jsonb; ordinals jsonb:='{}'::jsonb;
  choices jsonb; choice jsonb; base_label text; candidate text; label_key text; candidate_key text; ordinal integer;
begin
  if selected is null or cardinality(selected)>1000 then
    raise exception using errcode='P1022',message='selection_resource_limit'; end if;
  if cardinality(selected)=0 then return paths; end if;
  select count(*) into option_count from (
    select 1 from public.form_revision_options where revision_id=rev and field_id=field limit 1001
  ) bounded;
  if option_count>1000 then raise exception using errcode='P1022',message='option_resource_limit'; end if;
  -- Complete referenced revision, including retained inactive choices. Quote
  -- literal path delimiters/quotes/escapes so a root label cannot mimic a path.
  with bases as materialized (
    select option_id,parent_option_id,sort_order,
      case when position('/' in label)>0 or position('"' in label)>0 or position(chr(92) in label)>0
      then to_jsonb(coalesce(nullif(label,''),'Unnamed option'))::text
      else coalesce(nullif(label,''),'Unnamed option') end base
    from public.form_revision_options where revision_id=rev and field_id=field
  ) select coalesce(jsonb_agg(jsonb_build_object('id',option_id,'parent',parent_option_id,
    'base',base,'key',private.metadata_option_label_key(base)) order by sort_order,option_id),'[]'::jsonb)
    into choices from bases;
  select coalesce(jsonb_object_agg(value->>'key',true),'{}'::jsonb) into reserved
    from jsonb_array_elements(choices);
  for choice in select value from jsonb_array_elements(choices) loop
    base_label:=choice->>'base'; label_key:=choice->>'key';
    ordinal:=coalesce((ordinals->>label_key)::integer,1);
    candidate:=base_label;
    candidate_key:=label_key;
    if used ? label_key then
      loop
        ordinal:=greatest(2,ordinal);
        candidate:=base_label||' ('||ordinal::text||')';
        -- A retained Unicode-whitespace-only label has an empty key; the
        -- normalizer trims the suffix's leading space in that case too.
        candidate_key:=case when label_key='' then '(' else label_key||' (' end||ordinal::text||')';
        ordinal:=ordinal+1;
        exit when not (reserved ? candidate_key) and not (used ? candidate_key);
      end loop;
    end if;
    ordinals:=ordinals||jsonb_build_object(label_key,greatest(2,ordinal));
    used:=used||jsonb_build_object(candidate_key,true);
    labels:=labels||jsonb_build_object(choice->>'id',
      jsonb_build_object('parent',choice->'parent','label',candidate));
  end loop;
  foreach answer in array selected loop
    path:=null; current_id:=answer;
    for depth in 1..64 loop
      exit when current_id is null;
      node:=labels->current_id::text;
      exit when node is null;
      path:=array_prepend(node->>'label',path);
      current_id:=(node->>'parent')::uuid;
    end loop;
    if current_id is not null and node is not null then
      raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    path_json:=coalesce(to_jsonb(path),'null'::jsonb);
    path_bytes:=path_bytes+octet_length(path_json::text)+case when jsonb_array_length(paths)>0 then 2 else 0 end;
    if path_bytes>2096640 then
      raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
    paths:=paths||jsonb_build_array(path_json);
  end loop;
  return paths;
end;
$$;
revoke all on function private.metadata_compile_form(uuid,uuid,jsonb),
  private.metadata_option_paths(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
