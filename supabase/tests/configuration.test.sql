begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select has_column('public','app_members','can_manage_configuration','configuration grant is stored on membership');
select has_column('public','categories','removed_at','category tombstone exists');
select has_column('public','categories','version','category bigint version exists');
select has_table('public','configuration_events','configuration history exists');
select ok((select relrowsecurity from pg_class where oid='public.configuration_events'::regclass),'configuration events use RLS');
select ok((select relrowsecurity from pg_class where oid='public.label_defaults'::regclass),'label defaults use RLS');
select ok(not has_table_privilege('authenticated','public.configuration_events','INSERT'),'clients cannot append configuration history directly');
select ok(not has_table_privilege('authenticated','public.label_defaults','UPDATE'),'clients cannot update shared defaults directly');
select ok(not has_table_privilege('authenticated','public.app_members','UPDATE'),'clients cannot self-grant configuration access');
select ok(not has_function_privilege('anon','public.category_remove(uuid,jsonb)','EXECUTE'),'anonymous users cannot call removal');
select ok(has_function_privilege('authenticated','public.category_remove(uuid,jsonb)','EXECUTE'),'authenticated members can reach the guarded removal RPC');
select ok((select proconfig @> array['statement_timeout=5s'] from pg_proc where oid='public.category_remove(uuid,jsonb)'::regprocedure),'removal advertises a pre-execution timeout');

insert into auth.users(id,email) values('bad087c4-0369-4913-9347-f5969d991731','configuration-sql@example.test');
insert into public.app_members(user_id,display_name,role,can_manage_configuration)
values('bad087c4-0369-4913-9347-f5969d991731','Configuration SQL','staff',true);
select set_config('request.jwt.claims','{"sub":"bad087c4-0369-4913-9347-f5969d991731","role":"authenticated"}',true);
set local role authenticated;
select lives_ok($$select public.category_rename(gen_random_uuid(),jsonb_build_object(
  'category_id',(select id from public.categories where code='OTHER'),
  'expected_version','1','name','Alternate Other'))$$,'seed Other can be renamed');
select results_eq($$select name from public.categories where code='OTHER'$$,array['Alternate Other'],'renaming preserves the permanent code');
select lives_ok($$select public.category_remove(gen_random_uuid(),jsonb_build_object(
  'category_id',(select id from public.categories where code='OTHER'),
  'replacement_id',null,
  'review_token',(public.category_removal_review((select id from public.categories where code='OTHER'),null)->>'token')::uuid))$$,
  'unreferenced seed Other can be removed after review');
select results_eq($$select count(*) from public.categories where code='OTHER'$$,array[0::bigint],
  'removed unreferenced category is absent');
reset role;

select * from finish();
rollback;
