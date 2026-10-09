-- A max-supported legacy field must normalize once per field read, not once per
-- selected answer. Instrumentation and all fixtures disappear with this rollback.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table choice_scale_fixture as select gen_random_uuid() actor,
  gen_random_uuid() category,gen_random_uuid() revision,gen_random_uuid() field,
  gen_random_uuid() item,gen_random_uuid() event_id;
insert into auth.users(id,email) select actor,'choice-scale-'||actor::text||'@example.test' from choice_scale_fixture;
insert into public.app_members(user_id,display_name,role,active)
  select actor,'Choice scale viewer','viewer',true from choice_scale_fixture;
insert into public.categories(id,code,name)
  select category,'CHOICE-'||upper(replace(category::text,'-','')),'Choice scale '||category::text from choice_scale_fixture;
insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
  select revision,category,'draft',2,'{"fields":[],"layout":[]}'::jsonb from choice_scale_fixture;
insert into public.metadata_fields(id,category_id,field_type)
  select field,category,'multi_select' from choice_scale_fixture;
insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,rules,sort_order)
  select revision,field,'Legacy maximum choices',array['quantity'],false,'{"maxSelections":1000}',0 from choice_scale_fixture;
create temporary table choice_scale_options as select n position,gen_random_uuid() id,
  left(repeat('StraßeΣꭰﬃ',30),200) label from generate_series(1,1000) n;
insert into public.metadata_options(id,field_id)
  select o.id,f.field from choice_scale_options o cross join choice_scale_fixture f;
-- Deliberately emulate an immutable pre-rule publication with ambiguous labels.
-- This tests retained reads; fresh authoring still rejects these siblings.
insert into public.form_revision_options(revision_id,field_id,option_id,label,active,sort_order)
  select f.revision,f.field,o.id,o.label,true,o.position from choice_scale_options o cross join choice_scale_fixture f;
update public.category_form_revisions set status='published',published_at=now()
  where id=(select revision from choice_scale_fixture);
update public.categories set published_form_revision_id=(select revision from choice_scale_fixture)
  where id=(select category from choice_scale_fixture);
create temporary table choice_scale_values as select jsonb_build_object(f.field::text,
  jsonb_build_object('value',(select jsonb_agg(id::text order by position) from choice_scale_options),
    'validated_revision_id',f.revision)) custom_values from choice_scale_fixture f;
insert into public.quantity_items(id,name,category_id,custom_values,validated_form_revision_id)
  select f.item,'Maximum choice scale '||f.item::text,f.category,v.custom_values,f.revision
    from choice_scale_fixture f cross join choice_scale_values v;
insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,after_metadata,version)
  select f.event_id,f.item,'metadata_updated',f.actor,'Historical fixture',
    jsonb_build_object('category_id',f.category,'custom_values',v.custom_values),1
    from choice_scale_fixture f cross join choice_scale_values v;
select set_config('request.jwt.claims',json_build_object('sub',
  (select actor from choice_scale_fixture),'role','authenticated')::text,true);

-- Keep the existing normalizer OID so every cached caller sees instrumentation.
-- Its unmodified body is copied to a test-only private helper.
do $$
declare original text;
begin
  select pg_get_functiondef('private.metadata_option_label_key(text)'::regprocedure) into original;
  execute replace(original,'private.metadata_option_label_key(label text)',
    'private.metadata_option_label_key_uncounted(label text)');
end;
$$;
revoke all on function private.metadata_option_label_key_uncounted(text) from public,anon,authenticated,service_role;
create temporary sequence metadata_fold_calls;
create or replace function private.metadata_option_label_key(label text) returns text
language plpgsql volatile strict set search_path='' as $$
begin
  perform nextval('pg_temp.metadata_fold_calls'::regclass);
  return private.metadata_option_label_key_uncounted(label);
end;
$$;

set local statement_timeout='5s';
create temporary table choice_scale_clock(started timestamptz);
insert into choice_scale_clock values(clock_timestamp());
create temporary table choice_scale_read as select public.metadata_describe_values(v.custom_values,f.category) doc
  from choice_scale_fixture f cross join choice_scale_values v;
select diag('1000-selected detail read elapsed_ms='||round((extract(epoch from
  clock_timestamp()-(select started from choice_scale_clock))*1000)::numeric,2));
select is((select last_value from metadata_fold_calls),1000::bigint,
  '1000-selected detail read folds each of the 1000 labels exactly once');
select is((select jsonb_array_length(r.doc->f.field::text->'option_paths') from choice_scale_read r cross join choice_scale_fixture f),
  1000,'max-size detail returns every selected path without truncation');
select is((select r.doc->f.field::text->'value' from choice_scale_read r cross join choice_scale_fixture f),
  (select custom_values->f.field::text->'value' from choice_scale_values cross join choice_scale_fixture f),
  'max-size detail preserves answer IDs and their order');
select is((select r.doc->f.field::text->'option_paths'->0->>0 from choice_scale_read r cross join choice_scale_fixture f),
  (select label||case when position=1 then '' else ' ('||position::text||')' end from choice_scale_options where position=1),
  'first historical answer retains original spelling and its identity disambiguator');
select is((select r.doc->f.field::text->'option_paths'->999->>0 from choice_scale_read r cross join choice_scale_fixture f),
  (select label||case when position=1 then '' else ' ('||position::text||')' end from choice_scale_options where position=1000),
  'last historical answer retains original spelling and its identity disambiguator');

alter sequence metadata_fold_calls restart with 1;
update choice_scale_clock set started=clock_timestamp();
create temporary table choice_scale_export as select public.inventory_export_snapshot(
  'Maximum choice scale '||f.item::text,'quantity','active',f.category,null,false,'inventory',true) doc
  from choice_scale_fixture f;
select diag('1000-selected custom export elapsed_ms='||round((extract(epoch from
  clock_timestamp()-(select started from choice_scale_clock))*1000)::numeric,2));
select is((select last_value from metadata_fold_calls),1000::bigint,
  'max-size opt-in custom export folds each label exactly once');
select is((select doc->>'total' from choice_scale_export),'1','max-size export keeps the matching inventory row');
select is((select e.doc->'rows'->0->'custom_fields'->f.field::text->'option_paths'
  from choice_scale_export e cross join choice_scale_fixture f),
  (select r.doc->f.field::text->'option_paths' from choice_scale_read r cross join choice_scale_fixture f),
  'export and detail contain the same complete ordered historical paths');
select is((select e.doc->'rows'->0->'custom_fields'->f.field::text->>'validated_revision_id'
  from choice_scale_export e cross join choice_scale_fixture f),
  (select revision::text from choice_scale_fixture),'export retains exact immutable validation provenance');

alter sequence metadata_fold_calls restart with 1;
update choice_scale_clock set started=clock_timestamp();
create temporary table choice_scale_history as select public.metadata_event_custom_page(
  'quantity',f.event_id,'after',f.field,0) doc from choice_scale_fixture f;
select diag('1000-selected first history page elapsed_ms='||round((extract(epoch from
  clock_timestamp()-(select started from choice_scale_clock))*1000)::numeric,2));
select is((select last_value from metadata_fold_calls),1000::bigint,
  'existing 16-path history page folds the field once instead of 16 times');
select is((select jsonb_array_length(doc->'option_paths') from choice_scale_history),16,
  'history keeps the established page size');
select is((select jsonb_array_length(doc->'value') from choice_scale_history),1000,
  'history pagination does not truncate the stored answer');
select is((select doc->>'next_option_offset' from choice_scale_history),'16',
  'history exposes the next page of the complete answer');
create temporary table choice_scale_history_last as select public.metadata_event_custom_page(
  'quantity',f.event_id,'after',f.field,992) doc from choice_scale_fixture f;
select is((select jsonb_array_length(doc->'option_paths') from choice_scale_history_last),8,
  'the final history page exposes all eight remaining paths');
select is((select doc->'option_paths'->7->>0 from choice_scale_history_last),
  (select label||case when position=1 then '' else ' ('||position::text||')' end from choice_scale_options where position=1000),
  'history reaches the thousandth historical choice');

select throws_ok($$select private.metadata_option_paths(f.revision,f.field,
  array(select id from choice_scale_options union all select item from choice_scale_fixture))
  from choice_scale_fixture f$$,'P1022','selection_resource_limit',
  'over-limit batch requests fail explicitly rather than silently dropping answers');
select ok(not has_function_privilege('authenticated','private.metadata_option_paths(uuid,uuid,uuid[])','EXECUTE'),
  'batched path construction is private');

-- Exercise the private constructor's intermediate byte cap with bounded inputs.
-- This is a constructor stress case, not a hierarchy field's stored answer format.
create temporary table choice_scale_deep as select gen_random_uuid() revision,gen_random_uuid() field;
insert into public.category_form_revisions(id,category_id,status,revision_number,draft_definition)
  select d.revision,f.category,'draft',3,'{"fields":[],"layout":[]}'::jsonb
    from choice_scale_deep d cross join choice_scale_fixture f;
insert into public.metadata_fields(id,category_id,field_type)
  select d.field,f.category,'hierarchical_select' from choice_scale_deep d cross join choice_scale_fixture f;
insert into public.form_revision_fields(revision_id,field_id,label,applies_to,required,sort_order)
  select revision,field,'Bounded deep paths',array['quantity'],false,0 from choice_scale_deep;
create temporary table choice_scale_deep_options as select n position,gen_random_uuid() id from generate_series(1,64) n;
insert into public.metadata_options(id,field_id)
  select o.id,d.field from choice_scale_deep_options o cross join choice_scale_deep d;
insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
  select d.revision,d.field,o.id,p.id,repeat('😀',200),true,o.position
    from choice_scale_deep_options o left join choice_scale_deep_options p on p.position=o.position-1
    cross join choice_scale_deep d;
select throws_ok($$select private.metadata_option_paths(d.revision,d.field,
  array(select o.id from choice_scale_deep_options o cross join generate_series(1,1000) n where o.position=64))
  from choice_scale_deep d$$,'P1025','metadata_description_too_large',
  'intermediate byte overflow is explicit and never returns partial paths');

select * from finish();
rollback;
