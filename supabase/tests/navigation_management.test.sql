begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok(not has_function_privilege('authenticated','public.location_create(uuid,jsonb)','EXECUTE'), 'legacy create is unavailable to ordinary clients');
select ok(not has_function_privilege('authenticated','public.location_update(uuid,jsonb)','EXECUTE'), 'legacy structural update is unavailable to ordinary clients');
select ok(not has_function_privilege('service_role','public.location_create(uuid,jsonb)','EXECUTE'), 'service role fixture tooling cannot resurrect retired create RPC');
select ok(not has_function_privilege('service_role','public.location_update(uuid,jsonb)','EXECUTE'), 'service role fixture tooling cannot resurrect retired update RPC');
select ok(not has_function_privilege('anon','public.location_rename(uuid,jsonb)','EXECUTE'), 'anonymous rename is unavailable');
select ok(not has_function_privilege('anon','public.site_set_active(uuid,jsonb)','EXECUTE'), 'anonymous lifecycle change is unavailable');

create temporary table management_actors(kind text primary key,id uuid default gen_random_uuid());
insert into management_actors(kind) values('maintainer'),('staff'),('viewer');
insert into auth.users(id,email) select id,'management-'||kind||'@sql.example.test' from management_actors;
insert into public.app_members(user_id,display_name,role,active,can_manage_configuration)
 select id,'Management '||kind,case when kind='viewer' then 'viewer' else 'staff' end,true,kind='maintainer' from management_actors;
create temporary table management_requests(kind text primary key,id uuid default gen_random_uuid());
insert into management_requests(kind) values('rename'),('archive'),('legacy');
create temporary table location_before as select to_jsonb(l) as state from public.locations l where code='ITC-S1A';
create temporary table holding_counts as select
 (select count(*) from public.stock_balances) as stock,
 (select count(*) from public.quantity_events) as quantity_events,
 (select count(*) from public.asset_events) as asset_events;
grant select on management_actors,management_requests,location_before,holding_counts to authenticated;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from management_actors where kind='staff'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.location_create(gen_random_uuid(),'{}')$$,'42501',null,'even old payloads cannot create structure');
select throws_ok($$select public.location_update(gen_random_uuid(),'{}')$$,'42501',null,'even old payloads cannot alter structure');
select throws_ok($$select public.location_rename(gen_random_uuid(),'{}')$$,'P1001','forbidden','ordinary staff cannot rename');
select throws_ok($$select public.site_set_active(gen_random_uuid(),'{}')$$,'P1001','forbidden','ordinary staff cannot archive');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from management_actors where kind='viewer'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok($$select public.location_rename(gen_random_uuid(),'{}')$$,'P1001','forbidden','viewer cannot rename');
select throws_ok($$select public.site_set_active(gen_random_uuid(),'{}')$$,'P1001','forbidden','viewer cannot restore');
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from management_actors where kind='maintainer'),'role','authenticated')::text,true);
set local role authenticated;
select throws_ok(format('select public.location_rename(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','1','name','Renamed','sort_order',99)::text),
 'P1012','invalid_input','name-only RPC rejects structural fields');
create temporary table renamed_result as select public.location_rename((select id from management_requests where kind='rename'),
 jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','1','name','  Live adapters shelf  ')) as result;
select is((select name from public.locations where code='ITC-S1A'),'Live adapters shelf','rename normalizes the live display label');
select is((select to_jsonb(l)-array['name','version','updated_at'] from public.locations l where code='ITC-S1A'),
 (select state-array['name','version','updated_at'] from location_before),'rename preserves UUID code parent kind capability active sort and geometry binding');
select is((select (result->>'version') from renamed_result),'2','rename advances one version');
select is((select count(*)::integer from public.location_configuration_events where location_id=(select id from public.locations where code='ITC-S1A')),
 1,'rename appends one configuration event');
select is(public.location_rename((select id from management_requests where kind='rename'),
 jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','1','name','Live adapters shelf')),
 (select result from renamed_result),'normalized duplicate retry returns the completed receipt');
select throws_ok(format('select public.location_rename(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','1','name','Stale label')::text),
 'P1002','stale_version','new stale request cannot rename');
select is(public.location_rename(gen_random_uuid(),jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','2','name','Live adapters shelf'))->>'changed','false','same-name request is an audited receipt-backed no-op');
select throws_ok(format('select public.location_rename(%L::uuid,%L::jsonb)',(select id from management_requests where kind='rename'),jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','1','name','Different retry')::text),
 'P1009','idempotency_conflict','rename receipt cannot be reused for revised intent');
reset role;
select is((select count(*) from public.stock_balances),(select stock from holding_counts),'rename does not alter stock');
select is((select count(*) from public.quantity_events),(select quantity_events from holding_counts),'rename does not append inventory events');
select is((select count(*) from public.asset_events),(select asset_events from holding_counts),'rename preserves asset history');
select ok(exists(select 1 from public.locations where code='ITO-GENERAL' and can_hold_inventory),'coded office placeholder remains available');

create temporary table management_site as select (public.site_create(gen_random_uuid(),'{"code":"MANAGEMENT-TEST","name":"Fictional property","notes":"Retained notes"}')->>'entity_id')::uuid as id;
grant select on management_site to authenticated;
set local role authenticated;
select throws_ok(format('select public.site_update(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','name','Fictional property','notes','Retained notes','active',false)::text),
 'P1012','use_site_lifecycle','fresh legacy requests cannot omit the lifecycle reason');
select throws_ok(format('select public.site_set_active(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','active',false)::text),
 'P1012','invalid_input','archive requires a reason');
create temporary table archived_result as select public.site_set_active((select id from management_requests where kind='archive'),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','active',false,'reason',' Property closed ')) as result;
select ok((select not active and name='Fictional property' and notes='Retained notes' and code='MANAGEMENT-TEST' from public.sites where id=(select id from management_site)),
 'archive changes availability while retaining all metadata and identity');
select is((select reason from public.site_configuration_events where site_id=(select id from management_site) and version=2),'Property closed','lifecycle event preserves normalized reason');
select is(public.site_set_active((select id from management_requests where kind='archive'),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','active',false,'reason','Property closed')),
 (select result from archived_result),'archive duplicate returns the exact receipt');
select throws_ok(format('select public.site_set_active(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','active',true,'reason','Stale restore')::text),
 'P1002','stale_version','fresh stale lifecycle request cannot change availability');
select lives_ok(format('select public.site_set_active(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('site_id',(select id from management_site),'expected_version','2','active',true,'reason','Reopened')::text),'restore reuses the same identity');
select lives_ok(format('select public.site_update(%L::uuid,%L::jsonb)',gen_random_uuid(),jsonb_build_object('site_id',(select id from management_site),'expected_version','3','name','Renamed property','notes','Retained notes','active',true)::text),'legacy metadata updates with unchanged active state remain supported');
reset role;

-- Force a later audit failure: state, version and receipt must all roll back.
create function pg_temp.reject_management_event() returns trigger language plpgsql as $$
begin raise exception using errcode='P1999',message='test_audit_failure'; end; $$;
create trigger test_management_audit_failure before insert on public.location_configuration_events
 for each row execute function pg_temp.reject_management_event();
create temporary table rollback_request as select gen_random_uuid() as id;
grant select on rollback_request to authenticated;
set local role authenticated;
select throws_ok(format('select public.location_rename(%L::uuid,%L::jsonb)',(select id from rollback_request),jsonb_build_object('location_id',(select id from public.locations where code='ITC-S1A'),'expected_version','2','name','Must roll back')::text),
 'P1999','test_audit_failure','audit failure aborts rename');
reset role;
select is((select name from public.locations where code='ITC-S1A'),'Live adapters shelf','failed audit leaves display name unchanged');
select is((select version from public.locations where code='ITC-S1A'),2::bigint,'failed audit leaves version unchanged');
select is((select count(*)::integer from private.mutation_requests where request_id=(select id from rollback_request)),0,'failed audit leaves no receipt');
drop trigger test_management_audit_failure on public.location_configuration_events;

-- Simulate an already completed pre-migration lifecycle receipt. Replay must
-- remain available after current authorization, even though fresh callers upgrade.
insert into private.mutation_requests(actor_id,request_id,operation,request_payload,result)
select (select id from management_actors where kind='maintainer'),(select id from management_requests where kind='legacy'),'site_update',
 jsonb_build_object('site_id',(select id from management_site),'expected_version','1','name','Fictional property','notes','Retained notes','active',false),
 '{"entity_id":"00000000-0000-4000-8000-000000000001","version":"2","event_id":null,"changed":true}';
set local role authenticated;
select is(public.site_update((select id from management_requests where kind='legacy'),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','name','Fictional property','notes','Retained notes','active',false))->>'version','2','completed old lifecycle request can replay');
reset role;
update public.app_members set active=false where user_id=(select id from management_actors where kind='maintainer');
set local role authenticated;
select throws_ok(format('select public.location_rename(%L::uuid,%L::jsonb)',(select id from management_requests where kind='rename'),jsonb_build_object('location_id',(select state->>'id' from location_before),'expected_version','1','name','Live adapters shelf')::text),
 'P1001','forbidden','membership revocation is checked before completed rename replay');
select throws_ok(format('select public.site_set_active(%L::uuid,%L::jsonb)',(select id from management_requests where kind='archive'),jsonb_build_object('site_id',(select id from management_site),'expected_version','1','active',false,'reason','Property closed')::text),
 'P1001','forbidden','membership revocation is checked before completed archive replay');
reset role;
select * from finish();
rollback;
