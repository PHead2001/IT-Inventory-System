begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select has_table('public','category_form_revisions','published and draft forms are persisted');
select has_table('public','metadata_fields','stable field identities are relational');
select has_table('public','metadata_options','stable option identities are relational');
select has_table('public','form_revision_fields','published field settings are relational');
select has_table('public','form_revision_options','published option settings are relational');
select has_table('public','form_revision_controls','published controls are relational');
select has_column('public','quantity_items','custom_values','quantity values retain provenance');
select has_column('public','serialized_assets','custom_values','asset values retain provenance');
select ok((select count(*)=1 from public.category_form_revisions where category_id is null and status='published'),
  'one shared immutable baseline exists');
select ok((select count(distinct published_form_revision_id)=1 from public.categories),
  'untouched categories share canonical baseline');
select ok(private.metadata_currency_code_valid('USD') and
  private.metadata_currency_code_valid('XDR') and
  not private.metadata_currency_code_valid('ZZZ'),
  'currency rules use the pinned ISO code list');
select ok((select count(*)=1 from pg_trigger where tgname='category_form_pointer_valid'
  and tgrelid='public.categories'::regclass),
  'category pointers cannot reference a foreign or draft form');
select ok((select relrowsecurity from pg_class where oid='public.category_form_revisions'::regclass),
  'revisions use RLS');
select ok((select relrowsecurity from pg_class where oid='public.form_revision_fields'::regclass),
  'field configurations use RLS');
select ok(not has_table_privilege('authenticated','public.category_form_revisions','INSERT'),
  'clients cannot write revisions directly');
select ok(not has_table_privilege('authenticated','public.metadata_fields','UPDATE'),
  'clients cannot change field identity directly');
select ok(not has_table_privilege('authenticated','public.form_revision_options','DELETE'),
  'clients cannot delete published options directly');
select ok(not has_function_privilege('anon','public.metadata_publish(uuid,jsonb)','EXECUTE'),
  'anonymous publication is unavailable');
select ok(not has_function_privilege('anon','public.quantity_create_v2(uuid,jsonb)','EXECUTE'),
  'anonymous v2 creation is unavailable');
select ok(not has_function_privilege('authenticated','private.metadata_mutate_v2(uuid,jsonb,text,text)','EXECUTE'),
  'shared mutation helper is not directly callable');
select ok(not has_function_privilege('authenticated','private.metadata_category_references(uuid)','EXECUTE'),
  'category metadata impact helper is not directly callable');
select ok((select proconfig @> array['statement_timeout=5s'] from pg_proc
  where oid='public.metadata_publish(uuid,jsonb)'::regprocedure),
  'publication declares five-second database budget');
select ok((select proconfig @> array['statement_timeout=5s'] from pg_proc
  where oid='public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text,boolean)'::regprocedure),
  'bounded export declares five-second database budget');

select * from finish();
rollback;
