begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values ('11000000-0000-4000-8000-000000000001','file-capacity-staff@example.test');
insert into public.app_members(user_id,display_name,role,active) values ('11000000-0000-4000-8000-000000000001','Capacity Staff','staff',true);
insert into public.serialized_assets(id,name,category_id,location_id) select id,name,
 (select id from public.categories limit 1),(select id from public.locations where active and can_hold_inventory limit 1)
 from (values ('31000000-0000-4000-8000-000000000001'::uuid,'Capacity owned'),
 ('31000000-0000-4000-8000-000000000002'::uuid,'Capacity retained')) parents(id,name);
insert into private.file_keys(key_id,secret,accepts_new,verify_until) values ('capacitytest',repeat('q',32),true,now()+interval '1 hour');
select set_config('request.jwt.claims','{"sub":"11000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- These transaction-local metadata fixtures never assert physical deletion.
-- Real Storage completion/cleanup coverage is retained in files-completion.ts.
create function pg_temp.fixture(p_state text,p_reserved timestamptz,p_lease timestamptz default null,
 p_created timestamptz default now(),p_bytes bigint default 20971520,p_parent uuid default '31000000-0000-4000-8000-000000000002')
returns uuid language plpgsql as $$
declare f uuid:=gen_random_uuid();
begin
 insert into public.inventory_files(id,asset_id,uploader_id,original_name,display_title,declared_type,declared_bytes,
 purpose,reviewed_collection_revision,source_path,reserve_expires_at,state,validation_lease_until,created_at)
 values(f,p_parent,auth.uid(),'capacity.pdf','capacity.pdf','application/pdf',16,'asset_document',1,
 'capacity/'||f,p_reserved,p_state,p_lease,p_created);
 insert into private.file_objects(file_id,variant,path,bytes) values(f,'source','capacity/'||f,p_bytes);
 return f;
end $$;
create function pg_temp.reserve() returns jsonb language plpgsql as $$
declare expires bigint:=extract(epoch from now())::bigint+59; nonce text:=repeat('2',32); signed text;
begin
 signed:=auth.uid()::text||':reserve:asset:31000000-0000-4000-8000-000000000001:1:'||
 encode(convert_to('new.pdf','UTF8'),'hex')||':application/pdf:16:-:-:capacitytest:'||nonce||':'||expires;
 return public.inventory_file_reserve_ready('asset','31000000-0000-4000-8000-000000000001',1,'new.pdf','application/pdf',16,null,null,
 'capacitytest',nonce,expires,encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('q',32),'UTF8'),'sha256'),'hex'));
end $$;
create function pg_temp.start(p_file uuid) returns jsonb language plpgsql as $$
declare request_id uuid:=gen_random_uuid(); expires bigint:=extract(epoch from now())::bigint+59; nonce text:=repeat('3',32); signed text;
begin
 signed:=auth.uid()::text||':begin:'||p_file||':'||request_id||':capacitytest:'||nonce||':'||expires;
 return public.inventory_file_begin(p_file,request_id,'capacitytest',nonce,expires,
 encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('q',32),'UTF8'),'sha256'),'hex'));
end $$;

select pg_temp.fixture('reserved',now()-interval '31 seconds');
select pg_temp.fixture('uploaded',now()-interval '1 hour 1 second');
select pg_temp.fixture('validating',now()-interval '2 hours',now()-interval '31 seconds');
select pg_temp.fixture('validated',now()-interval '2 hours',now()-interval '1 hour',now()-interval '24 hours 1 second');
select is((select count(*) from public.inventory_files f where private.file_pending_active(f,now())),0::bigint,
 'all four expired pending states on unrelated parent are inactive');
select is(private.file_staging_bytes(now()),83886080::bigint,'all four unconfirmed held sources keep their full object charge');
set local role authenticated;
select lives_ok($$select pg_temp.reserve()$$,'expired unrelated rows no longer permanently exhaust actor slots');
reset role;
select is((select count(*) from public.inventory_files where asset_id='31000000-0000-4000-8000-000000000002' and state in ('reserved','uploaded','validating','validated')),4::bigint,
 'new reservation does not expire or rewrite any unrelated lifecycle state');
select is((select count(*) from private.file_objects o join public.inventory_files f on f.id=o.file_id
 where f.asset_id='31000000-0000-4000-8000-000000000002' and o.cleanup_state='held'),4::bigint,
 'new reservation does not change unrelated held objects or claims');
select is(private.file_staging_bytes(now()),104857600::bigint,'new active allowance adds to retained expired bytes');
set local role authenticated;
select lives_ok($$select pg_temp.reserve()$$,'second PDF still fits retained object charge');
select throws_ok($$select pg_temp.reserve()$$,'P1012','staging_quota','expired object bytes still prevent crossing staging cap');
reset role;
-- Dispose only transaction-local metadata fixtures between independent cases.
delete from private.file_objects where file_id in(select id from public.inventory_files where uploader_id=auth.uid());
delete from public.inventory_files where uploader_id=auth.uid();

select pg_temp.fixture('reserved',now()-interval '29 seconds');
select pg_temp.fixture('uploaded',now()-interval '59 minutes');
select pg_temp.fixture('validated',now()-interval '2 hours',null,now()-interval '23 hours');
set local role authenticated;
select throws_ok($$select pg_temp.reserve()$$,'P1012','pending_quota','three active rows across parents still exhaust actor slots');
reset role;
-- Dispose only transaction-local metadata fixtures between independent cases.
delete from private.file_objects where file_id in(select id from public.inventory_files where uploader_id=auth.uid());
delete from public.inventory_files where uploader_id=auth.uid();

select pg_temp.fixture('validating',now()-interval '2 hours',now()+interval '1 minute',now()-interval '25 hours',16);
select pg_temp.fixture('validating',now()-interval '2 hours',now()-interval '29 seconds',now()-interval '25 hours',16);
select pg_temp.fixture('validated',now()-interval '2 hours',now()+interval '1 minute',now()-interval '25 hours',16);
select is((select count(*) from public.inventory_files f where private.file_pending_active(f,now())),3::bigint,
 'live lease and grace protect slots even after reservation or validated age expiry');
update public.inventory_files set declared_type='image/png',purpose='asset_photo' where state='validated';
select is(private.file_staging_bytes(now()),104857600::bigint,'live and grace leases retain worst-case allowances despite tiny source bytes');
set local role authenticated;
select throws_ok($$select pg_temp.reserve()$$,'P1012','pending_quota','lease expiry alone does not free active grace slots');
reset role;
-- Dispose only transaction-local metadata fixtures between independent cases.
delete from private.file_objects where file_id in(select id from public.inventory_files where uploader_id=auth.uid());
delete from public.inventory_files where uploader_id=auth.uid();

select pg_temp.fixture('validating',now()-interval '2 hours',null,now()-interval '25 hours');
select is(private.file_staging_bytes(now()),20971520::bigint,'missing lease never erases held unconfirmed source charge');
insert into private.file_objects(file_id,variant,generation,path,bytes,cleanup_state)
 select id,'display',1,source_path||'/derived',20971520,'held' from public.inventory_files;
select is(private.file_staging_bytes(now()),41943040::bigint,'expired held derivative stays charged without absent proof');
update private.file_objects set cleanup_state='claimed',cleanup_actor=auth.uid(),cleanup_lease_until=now()-interval '1 day';
select is(private.file_staging_bytes(now()),41943040::bigint,'expired cleanup lease does not release any object bytes');
-- Dispose only transaction-local metadata fixtures between independent cases.
delete from private.file_objects where file_id in(select id from public.inventory_files where uploader_id=auth.uid());
delete from public.inventory_files where uploader_id=auth.uid();

select pg_temp.fixture('cancelled',now()-interval '2 hours',now()-interval '29 seconds',now()-interval '25 hours',16);
update public.inventory_files set declared_type='image/png',purpose='asset_photo';
select is(private.file_staging_bytes(now()),62914560::bigint,'terminal work with a protected worker grace retains full allowance');
update public.inventory_files set validation_lease_until=now()-interval '31 seconds';
select is(private.file_staging_bytes(now()),16::bigint,'after grace only actual reserved object bytes remain charged, never zero');
-- Dispose only transaction-local metadata fixtures between independent cases.
delete from private.file_objects where file_id in(select id from public.inventory_files where uploader_id=auth.uid());
delete from public.inventory_files where uploader_id=auth.uid();

-- Insert a source through the actual completion trigger while its reservation
-- is valid; only then age the metadata. No body or size assumption bypass.
select pg_temp.fixture('reserved',now()+interval '1 hour',null,now(),16,'31000000-0000-4000-8000-000000000001');
insert into storage.objects(bucket_id,name,owner,owner_id,metadata,version)
 select 'inventory-files',source_path,uploader_id,uploader_id::text,'{"size":16}'::jsonb,gen_random_uuid()::text from public.inventory_files;
update private.file_objects o set object_id=s.id,object_version=s.version from storage.objects s where s.name=o.path;
update public.inventory_files set state='uploaded',reserve_expires_at=now()-interval '2 hours';
select pg_temp.fixture('reserved',now()+interval '1 hour');
select pg_temp.fixture('reserved',now()+interval '1 hour');
select pg_temp.fixture('reserved',now()+interval '1 hour');
create temporary table retry_file as select id from public.inventory_files where state='uploaded';
grant select on retry_file to authenticated;
set local role authenticated;
select throws_ok(format('select pg_temp.start(%L)',(select id from retry_file)),'P1012','pending_quota',
 'expired validation renewal must atomically re-enter active actor quota');
reset role;
select is((select state from public.inventory_files where id=(select id from retry_file)),'uploaded','failed admission rolls back state');
select is((select validation_generation from public.inventory_files where id=(select id from retry_file)),0,'failed admission rolls back generation');
select is((select validation_lease_until from public.inventory_files where id=(select id from retry_file)),null::timestamptz,'failed admission creates no lease');
update public.inventory_files set state='cancelled' where id=(select id from public.inventory_files where state='reserved' limit 1);
set local role authenticated;
select lives_ok(format('select pg_temp.start(%L)',(select id from retry_file)),'explicit retry succeeds when re-admission capacity is available');
reset role;
select is((select count(*) from public.inventory_files f where private.file_pending_active(f,clock_timestamp())),3::bigint,'renewed lease consumes the third slot');
-- Independent byte-cap renewal case retains the same real-trigger source.
delete from private.file_objects where file_id<>(select id from retry_file) and file_id in(select id from public.inventory_files where uploader_id=auth.uid());
delete from public.inventory_files where id<>(select id from retry_file) and uploader_id=auth.uid();
update public.inventory_files set state='uploaded',validation_lease_until=null;
select pg_temp.fixture('cancelled',now()-interval '2 hours') from generate_series(1,6);
set local role authenticated;
select throws_ok(format('select pg_temp.start(%L)',(select id from retry_file)),'P1012','staging_quota',
 'explicit renewal must re-admit worst-case allowance alongside every retained byte');
reset role;
select is((select validation_generation from public.inventory_files where id=(select id from retry_file)),1,'byte-quota failure rolls back new generation');
select is((select validation_lease_until from public.inventory_files where id=(select id from retry_file)),null::timestamptz,'byte-quota failure rolls back new lease');
-- Preparing another object has the same accounting gate; it cannot resurrect
-- unallocated capacity through a still-signed generation.
update public.inventory_files set state='validating',declared_type='image/png',purpose='asset_photo',
 validation_lease_until=now()+interval '5 minutes' where id=(select id from retry_file);
create function pg_temp.prepare(p_file uuid) returns void language plpgsql as $$
declare nonce text:=repeat('4',32); expires bigint:=extract(epoch from now())::bigint+59;
 path text; generation integer; signed text; digest text:=repeat('0',64);
begin
 generation:=1;
 signed:=auth.uid()::text||':'||p_file||':'||generation||':display:'||nonce||':'||expires;
 path:='d/capacitytest/'||p_file||'/'||generation||'/display/'||nonce||'/'||expires||'/'||
 encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('q',32),'UTF8'),'sha256'),'hex');
 signed:=auth.uid()::text||':'||p_file||':'||generation||':display:'||path||':16:'||digest;
 perform public.inventory_file_prepare_variant(p_file,generation,'display',path,16,digest,
 encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('q',32),'UTF8'),'sha256'),'hex'));
end $$;
set local role authenticated;
select throws_ok(format('select pg_temp.prepare(%L)',(select id from retry_file)),'P1012','staging_quota',
 'signed variant preparation retains unrelated expired/terminal object charges');
reset role;
select is((select count(*) from private.file_objects where file_id=(select id from retry_file)),1::bigint,'failed variant preparation leaves no derivative tombstone');
select * from finish();
rollback;
