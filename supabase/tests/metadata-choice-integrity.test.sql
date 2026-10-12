begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

-- Each call rolls back its private fixtures, including successful compiles.
create function pg_temp.compile_choices(choices jsonb, kind text default 'hierarchical_select', rules jsonb default '{}'::jsonb)
returns text language plpgsql as $$
declare category uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid(); field uuid:=gen_random_uuid();
  definition jsonb; result text;
begin
  begin
    insert into public.categories(id,code,name) values(category,'AUDIT2-'||upper(replace(category::text,'-','')),'Audit 2 '||category::text);
    select private.metadata_effective_definition(id,draft_definition) into definition
      from public.category_form_revisions where category_id is null and status='published';
    definition:=jsonb_set(definition,'{fields}',jsonb_build_array(jsonb_build_object(
      'id',field,'type',kind,'label','Connector','applies_to',jsonb_build_array('quantity','asset'),
      'required',false,'rules',rules,'options',choices)));
    if kind='boolean' then definition:=jsonb_set(definition,array['fields','0','default'],'false'::jsonb); end if;
    insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
      values(revision,category,'draft',2,definition);
    perform private.metadata_compile_form(revision,category,definition);
    result:='ok';
    if kind='boolean' and not private.metadata_value_valid(revision,field,'false'::jsonb) then result:='false invalid'; end if;
    raise exception using errcode='P9999',message='rollback_test_fixture';
  exception when sqlstate 'P9999' then return result;
    when others then return sqlstate||':'||sqlerrm;
  end;
end;
$$;

select is(pg_temp.compile_choices('[
  {"id":"00000000-0000-4000-8000-000000000001","label":"Straße","active":true},
  {"id":"00000000-0000-4000-8000-000000000002","label":" STRASSE ","active":true}
]'), 'P1021:ambiguous_active_field_options', 'fresh publication rejects root full-fold siblings');
select is(pg_temp.compile_choices('[
  {"id":"00000000-0000-4000-8000-000000000001","label":"USB","active":true},
  {"id":"00000000-0000-4000-8000-000000000002","label":"Café","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"},
  {"id":"00000000-0000-4000-8000-000000000003","label":"CAFÉ","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"}
]'), 'P1021:ambiguous_active_field_options', 'fresh publication rejects canonical-equivalent nested siblings');
select is(pg_temp.compile_choices('[
  {"id":"00000000-0000-4000-8000-000000000001","label":"USB","active":true},
  {"id":"00000000-0000-4000-8000-000000000002","label":"Network","active":true},
  {"id":"00000000-0000-4000-8000-000000000003","label":"Shared","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"},
  {"id":"00000000-0000-4000-8000-000000000004","label":"shared","active":true,"parent_id":"00000000-0000-4000-8000-000000000002"}
]'), 'P1021:ambiguous_active_field_options', 'fresh cross-parent labels must be distinguishable throughout the field');
select is(pg_temp.compile_choices('[
  {"id":"00000000-0000-4000-8000-000000000001","label":"Same","active":true},
  {"id":"00000000-0000-4000-8000-000000000002","label":"same","active":false}
]'), 'ok', 'inactive historical sibling does not block publication');
select is(pg_temp.compile_choices('[
  {"id":"00000000-0000-4000-8000-000000000001","label":"Same","active":true},
  {"id":"00000000-0000-4000-8000-000000000002","label":"same","active":true}
]', 'multi_select'), 'P1021:ambiguous_active_field_options', 'flat multiple choice has the same sibling rule');
select is(pg_temp.compile_choices('[]','boolean','{"booleanPresentation":"yes_no"}'), 'ok', 'Yes/No presentation preserves false as a valid default and answer');
select is(pg_temp.compile_choices('[]','boolean','{}'), 'ok', 'old checkbox callers remain valid');
select is(pg_temp.compile_choices('[]','boolean','{"booleanPresentation":"unknown"}'), 'P1021:invalid_boolean_presentation', 'fabricated presentation is rejected authoritatively');
select is(pg_temp.compile_choices('[]','short_text','{"booleanPresentation":"yes_no"}'), 'P1021:unsupported_form_rule', 'boolean presentation cannot leak onto another datatype');
select ok(not private.metadata_rules_consequential('boolean','{}','{"booleanPresentation":"yes_no"}'), 'presentation is excluded from consequential validation changes');
select ok(not has_function_privilege('authenticated','private.metadata_option_label_key(text)','EXECUTE'), 'normalization helper is private');

select is(pg_temp.compile_choices((select jsonb_agg(jsonb_build_object('id',md5(n::text)::uuid,'label','Level '||n,'active',true,
  'parent_id',case when n=1 then null else md5((n-1)::text)::uuid end)) from generate_series(1,64) n)),
  'ok', 'canonical 64-level hierarchy limit is accepted');
select is(pg_temp.compile_choices((select jsonb_agg(jsonb_build_object('id',md5(n::text)::uuid,'label','Level '||n,'active',true,
  'parent_id',case when n=1 then null else md5((n-1)::text)::uuid end)) from generate_series(1,65) n)),
  'P1022:option_depth_or_cycle', 'fabricated over-depth hierarchy is rejected');
select is(pg_temp.compile_choices('[
  {"id":"00000000-0000-4000-8000-000000000001","label":"One","active":true,"parent_id":"00000000-0000-4000-8000-000000000002"},
  {"id":"00000000-0000-4000-8000-000000000002","label":"Two","active":true,"parent_id":"00000000-0000-4000-8000-000000000001"}
]'), 'P1022:option_depth_or_cycle', 'fabricated cycles still fail the canonical compiler');

create function pg_temp.legacy_paths_unchanged() returns boolean language plpgsql as $$
declare category uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid(); field uuid:=gen_random_uuid();
  reordered uuid:=gen_random_uuid();
  first uuid:='00000000-0000-4000-8000-000000000001'; second uuid:='00000000-0000-4000-8000-000000000002';
  child uuid:='00000000-0000-4000-8000-000000000003'; result boolean;
  blank_first uuid:='00000000-0000-4000-8000-000000000004'; blank_second uuid:='00000000-0000-4000-8000-000000000005';
  literal uuid:='00000000-0000-4000-8000-000000000006';
begin
  begin
    insert into public.categories(id,code,name) values(category,'LEGACY-'||upper(replace(category::text,'-','')),'Legacy '||category::text);
    insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
      values(revision,category,'draft',2,'{"fields":[],"layout":[]}');
    insert into public.metadata_fields(id,category_id,field_type) values(field,category,'hierarchical_select');
    insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,sort_order)
      values(revision,field,'Legacy choices',array['quantity'],false,0);
    insert into public.metadata_options(id,field_id) values(first,field),(second,field),(child,field),
      (blank_first,field),(blank_second,field),(literal,field);
    insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
      values(revision,field,first,null,'USB',true,0),(revision,field,second,null,'usb',true,1),
        (revision,field,child,second,'Cable',true,2),
        (revision,field,blank_first,null,chr(160),true,3),
        (revision,field,blank_second,null,chr(65279),false,4),
        (revision,field,literal,null,'(2)',true,5);
    update public.category_form_revisions set status='published',published_at=now() where id=revision;
    result:=private.metadata_option_path(revision,field,child)=array['usb (2)','Cable']
      and private.metadata_option_paths(revision,field,array[child,first])=jsonb_build_array(
        jsonb_build_array('usb (2)','Cable'),jsonb_build_array('USB'))
      and (select label='usb' from public.form_revision_options where revision_id=revision and option_id=second)
      and private.metadata_option_path(revision,field,blank_second)=array[chr(65279)||' (3)']
      and private.metadata_option_path(revision,field,literal)=array['(2)']
      and private.metadata_value_valid(revision,field,to_jsonb(child::text));
    -- A separate published revision changes only navigation order. Neither the
    -- original publication nor its answers are updated to stabilize labels.
    insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
      values(reordered,category,'draft',3,'{"fields":[],"layout":[]}');
    insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,sort_order)
      select reordered,field_id,label,applies_to,required,sort_order
      from public.form_revision_fields where revision_id=revision;
    insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
      select reordered,field_id,option_id,parent_option_id,label,active,5-sort_order
      from public.form_revision_options where revision_id=revision;
    update public.category_form_revisions set status='published',published_at=now() where id=reordered;
    result:=result and private.metadata_option_paths(reordered,field,array[child,first,second,blank_first,blank_second,literal])
      =private.metadata_option_paths(revision,field,array[child,first,second,blank_first,blank_second,literal])
      and (select sort_order=0 and label='USB' from public.form_revision_options where revision_id=revision and option_id=first)
      and (select sort_order=5 from public.form_revision_options where revision_id=reordered and option_id=first);
    raise exception using errcode='P9999',message='rollback_test_fixture';
  exception when sqlstate 'P9999' then return result;
  end;
end;
$$;
select ok(pg_temp.legacy_paths_unchanged(), 'published reorder preserves duplicate, inactive, literal-suffix and ancestor display identity without rewriting original choices');

select * from finish();
rollback;
