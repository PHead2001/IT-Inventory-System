begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_function('public','asset_create_v3',array['uuid','jsonb']);
select has_function('public','asset_update_v3',array['uuid','jsonb']);
select has_function('public','asset_site_open_v3',array['uuid','jsonb']);
select has_function('public','metadata_preview_batch',array['jsonb']);
select has_function('public','inventory_location_entry_counts',array['text[]']);
select has_function('public','inventory_asset_tag_lookup',array['text']);
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),role_name||' cannot invoke '||signature)
from (values ('anon'),('service_role')) roles(role_name)
cross join (values ('public.asset_create_v3(uuid,jsonb)'),('public.asset_update_v3(uuid,jsonb)'),
 ('public.asset_site_open_v3(uuid,jsonb)'),('public.metadata_preview_batch(jsonb)'),
 ('public.inventory_location_entry_counts(text[])'),('public.inventory_asset_tag_lookup(text)')) functions(signature);
select ok(not has_function_privilege('authenticated','private.asset_metadata_mutate_v3(uuid,jsonb,text)','EXECUTE'),
 'authenticated callers cannot bypass the public wrapper');
select ok(not has_function_privilege('authenticated','public.location_create(uuid,jsonb)','EXECUTE'),
 'structural creation remains revoked');
select ok(not has_function_privilege('authenticated','public.location_update(uuid,jsonb)','EXECUTE'),
 'structural editing remains revoked');
select is((select count(*)::integer from (
 select parent_id,lower(btrim(name)) from public.locations where active
 group by parent_id,lower(btrim(name)) having count(*)>1
) collisions),0,'canonical reference data has no active sibling-name collisions');
select ok(exists(select 1 from pg_attribute a where a.attrelid='public.serialized_assets'::regclass
 and a.attname='asset_tag_normalized' and a.attgenerated='s'),'normalized asset key is generated at the database boundary');
select * from finish();
rollback;
