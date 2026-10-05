begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values ('12000000-0000-4000-8000-000000000001','file-allocation-staff@example.test');
insert into public.app_members(user_id,display_name,role,active) values ('12000000-0000-4000-8000-000000000001','Allocation Staff','staff',true);
insert into public.serialized_assets(id,name,category_id,location_id) select id,name,
 (select id from public.categories limit 1),(select id from public.locations where active and can_hold_inventory limit 1)
 from (values ('32000000-0000-4000-8000-000000000001'::uuid,'Allocation owned'),
 ('32000000-0000-4000-8000-000000000002'::uuid,'Allocation retained')) parents(id,name);
insert into private.file_keys(key_id,secret,accepts_new,verify_until) values ('allocationtest',repeat('r',32),true,now()+interval '1 hour');
select set_config('request.jwt.claims','{"sub":"12000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
-- Transaction-local byte-accounting fixtures do not claim physical Storage
-- deletion. The canonical files-completion integration retains that proof.
create function pg_temp.fixture(p_state text,p_purpose text default 'asset_photo') returns uuid language plpgsql as $$
declare f uuid:=gen_random_uuid();
begin
 insert into public.inventory_files(id,asset_id,uploader_id,original_name,display_title,declared_type,declared_bytes,
 purpose,reviewed_collection_revision,source_path,reserve_expires_at,state,validation_generation,validation_lease_until)
 values(f,'32000000-0000-4000-8000-000000000002',auth.uid(),'allocation.png','allocation.png',
 case when p_purpose='asset_document' then 'application/pdf' else 'image/png' end,16,p_purpose,1,
 'allocation/'||f,now()-interval '2 hours',p_state,2,now()+interval '5 minutes');
 insert into private.file_objects(file_id,variant,generation,path,bytes,cleanup_state)
 select f,variant,generation,'allocation/'||f||'/'||variant,20971520,'eligible'
 from (values ('source',0),('display',2),('thumbnail',2)) objects(variant,generation);
 return f;
end $$;
create function pg_temp.clear_files() returns void language plpgsql as $$
begin
 delete from private.file_objects where file_id in(select id from public.inventory_files where uploader_id=auth.uid());
 delete from public.inventory_files where uploader_id=auth.uid();
end $$;
create function pg_temp.reserve_photo() returns jsonb language plpgsql as $$
declare expires bigint:=extract(epoch from now())::bigint+59; nonce text:=repeat('5',32); signed text;
begin
 signed:=auth.uid()::text||':reserve:asset:32000000-0000-4000-8000-000000000001:1:'||
 encode(convert_to('new.png','UTF8'),'hex')||':image/png:16:-:-:allocationtest:'||nonce||':'||expires;
 return public.inventory_file_reserve_ready('asset','32000000-0000-4000-8000-000000000001',1,'new.png','image/png',16,null,null,
 'allocationtest',nonce,expires,encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('r',32),'UTF8'),'sha256'),'hex'));
end $$;

select pg_temp.fixture('rejected');
select is(private.file_staging_bytes(now()),62914560::bigint,'rejected live-lease current source and derivatives charge 60 MiB once, not 120');
select pg_temp.clear_files();
select pg_temp.fixture('cancelled');
select is(private.file_staging_bytes(now()),62914560::bigint,'cancelled live-lease current source and derivatives charge 60 MiB once');
update private.file_objects set cleanup_state='claimed',cleanup_actor=auth.uid(),cleanup_lease_until=now()+interval '1 minute';
select is(private.file_staging_bytes(now()),62914560::bigint,'current-generation cleanup claims remain covered by the live allowance');
update private.file_objects set cleanup_state='held',cleanup_actor=null,cleanup_lease_until=null;
select is(private.file_staging_bytes(now()),62914560::bigint,'held current objects remain covered by the live allowance');
insert into private.file_objects(file_id,variant,generation,path,bytes,cleanup_state)
 select id,'display',1,source_path||'/old-display',20971520,'eligible' from public.inventory_files where uploader_id=auth.uid();
select is(private.file_staging_bytes(now()),83886080::bigint,'obsolete derivative adds 20 MiB outside current 60 MiB allowance');
update private.file_objects set cleanup_state='held' where generation=1;
select is(private.file_staging_bytes(now()),83886080::bigint,'undeleted obsolete held generation retains its independent charge');
update private.file_objects set cleanup_state='deleted' where generation=1;
select is(private.file_staging_bytes(now()),62914560::bigint,'only confirmed obsolete deletion releases its extra charge');
update private.file_objects set cleanup_state='eligible' where generation=1;
update public.inventory_files set validation_lease_until=now()-interval '29 seconds' where uploader_id=auth.uid();
select is(private.file_staging_bytes(now()),83886080::bigint,'worker grace retains current allowance plus obsolete bytes');
update public.inventory_files set validation_lease_until=now()-interval '31 seconds' where uploader_id=auth.uid();
update private.file_objects set bytes=1048576 where generation=0 or generation=2;
select is(private.file_staging_bytes(now()),24117248::bigint,'after grace actual current and obsolete retained bytes remain charged');
update private.file_objects set cleanup_state='deleted';
select is(private.file_staging_bytes(now()),0::bigint,'confirmed deletion after grace leaves zero retained bytes');
update public.inventory_files set validation_lease_until=now()+interval '1 minute' where uploader_id=auth.uid();
select is(private.file_staging_bytes(now()),62914560::bigint,'live worker allowance persists even if currently registered objects are deleted');
select pg_temp.clear_files();

select pg_temp.fixture('cancelled','asset_document');
select is(private.file_staging_bytes(now()),62914560::bigint,'actual current bytes above PDF 20 MiB allowance remain fully charged');
update private.file_objects set cleanup_state='deleted' where variant<>'source';
select is(private.file_staging_bytes(now()),20971520::bigint,'ordinary PDF source is covered once by its 20 MiB allowance');
select pg_temp.clear_files();

select pg_temp.fixture('cancelled');
set local role authenticated;
select lives_ok($$select pg_temp.reserve_photo()$$,'new photo admits beside another parent cancelled live-lease 60 MiB file');
reset role;
select is(private.file_staging_bytes(now()),125829120::bigint,'two live photo allowances total 120 MiB within 128 MiB staging cap');
select is((select count(*) from public.inventory_files where asset_id='32000000-0000-4000-8000-000000000002' and state='cancelled'),1::bigint,
 'admission preserves the other parent cancelled state');
select is((select count(*) from private.file_objects o join public.inventory_files f on f.id=o.file_id
 where f.asset_id='32000000-0000-4000-8000-000000000002' and o.cleanup_state='eligible'),3::bigint,
 'admission does not claim or rewrite retained parent objects');
set local role authenticated;
select throws_ok($$select pg_temp.reserve_photo()$$,'P1012','staging_quota','third photo still fails authoritative staging quota');
reset role;
select pg_temp.clear_files();

select pg_temp.fixture('ready');
update private.file_objects set cleanup_state='held';
select is(private.file_staging_bytes(now()),0::bigint,'ready referenced held bytes are outside staging accounting');
update private.file_objects set cleanup_state='eligible' where variant='source';
select is(private.file_staging_bytes(now()),20971520::bigint,'ready eligible source remains staged until confirmed deletion');
update public.inventory_files set state='removed' where uploader_id=auth.uid();
select is(private.file_staging_bytes(now()),20971520::bigint,'removed file charges only eligible or claimed bytes');
update private.file_objects set cleanup_state='claimed',cleanup_actor=auth.uid(),cleanup_lease_until=now()-interval '1 day' where variant<>'source';
select is(private.file_staging_bytes(now()),62914560::bigint,'expired removal claims retain every unconfirmed object charge');
select * from finish();
rollback;
