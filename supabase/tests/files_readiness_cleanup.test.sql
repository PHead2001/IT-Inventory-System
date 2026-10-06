begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','file-readiness-staff@example.test'),
 ('10000000-0000-4000-8000-000000000002','file-readiness-viewer@example.test'),
 ('10000000-0000-4000-8000-000000000003','file-readiness-inactive@example.test');
insert into public.app_members(user_id,display_name,role,active) values
 ('10000000-0000-4000-8000-000000000001','File Staff','staff',true),
 ('10000000-0000-4000-8000-000000000002','File Viewer','viewer',true),
 ('10000000-0000-4000-8000-000000000003','Inactive Staff','staff',false);
insert into public.quantity_items(id,name,category_id) select
 id,name,(select id from public.categories limit 1) from (values
 ('20000000-0000-4000-8000-000000000001'::uuid,'Owned empty'),
 ('20000000-0000-4000-8000-000000000002'::uuid,'Other retained'),
 ('20000000-0000-4000-8000-000000000003'::uuid,'Untouched empty')) fixture(id,name);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
select is(public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000001'),
 '{"outstanding":0,"blocked":0}'::jsonb,'authorized empty parent needs no key or maintenance');
select throws_ok($$select public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000099')$$,
 'P1010','not_found','nonexistent parent is not an empty success');
select throws_ok($$select public.inventory_file_reserve('quantity','20000000-0000-4000-8000-000000000001',1,'photo.png','image/png',16,null,null)$$,
 'P1014','file_upload_requires_current_application','unsigned old application cannot create a reservation');
select throws_ok($$select public.inventory_file_reserve_ready('quantity','20000000-0000-4000-8000-000000000001',1,'photo.png','image/png',16,null,null,'testkey',null,null,null)$$,
 'P1013','file_validation_unavailable','no DB readiness creates no reservation');
reset role;
select is((select count(*) from public.inventory_files where quantity_id='20000000-0000-4000-8000-000000000001'),0::bigint,'failed readiness leaves no file/reservation/tombstone');
insert into private.file_keys(key_id,secret,accepts_new,verify_until)
 values('cp5testkey',repeat('x',32),true,now()+interval '1 hour');
-- Fixed fictional key only in this rolled-back test transaction. No production
-- entrypoint can create server proofs or call the private reservation helper.
create function pg_temp.reserve(p_parent uuid,p_name text,p_signed_name text default null) returns jsonb
language plpgsql as $$
declare expires bigint:=extract(epoch from now())::bigint+59; nonce text:=repeat('0',32); signed text;
begin
 signed:=auth.uid()::text||':reserve:quantity:'||p_parent::text||':1:'||
  encode(convert_to(coalesce(p_signed_name,p_name),'UTF8'),'hex')||':image/png:16:-:-:cp5testkey:'||nonce||':'||expires;
 return public.inventory_file_reserve_ready('quantity',p_parent,1,p_name,'image/png',16,null,null,
  'cp5testkey',nonce,expires,encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('x',32),'UTF8'),'sha256'),'hex'));
end $$;
create function pg_temp.claim(p_parent uuid) returns jsonb language plpgsql as $$
declare expires bigint:=extract(epoch from now())::bigint+59; nonce text:=repeat('1',32); signed text;
begin
 signed:=auth.uid()::text||':cleanup_claim:quantity:'||p_parent::text||':20:cp5testkey:'||nonce||':'||expires;
 return public.inventory_file_cleanup_claim_parent('quantity',p_parent,20,'cp5testkey',nonce,expires,
  encode(extensions.hmac(convert_to(signed,'UTF8'),convert_to(repeat('x',32),'UTF8'),'sha256'),'hex'));
end $$;
set local role authenticated;
select throws_ok($$select pg_temp.reserve('20000000-0000-4000-8000-000000000001','Colon:name π.png','Colon:name π.png:shift')$$,
 'P1013','file_validation_unavailable','delimiter/unicode name tampering fails matching server proof');
select lives_ok($$select pg_temp.reserve('20000000-0000-4000-8000-000000000001','Colon:name π.png')$$,
 'matching UTF8-encoded proof accepts exact business input');
select lives_ok($$select pg_temp.reserve('20000000-0000-4000-8000-000000000002','retained.png')$$,'separate parent gets its own reservation');
reset role;
-- The unrelated reservation is old enough to expire, and also has an old claim.
-- Every update and the returned-claims query must still exclude that parent.
update public.inventory_files set reserve_expires_at=now()-interval '2 hours'
 where quantity_id='20000000-0000-4000-8000-000000000002';
update private.file_objects set cleanup_state='claimed',cleanup_actor='10000000-0000-4000-8000-000000000001',cleanup_lease_until=now()+interval '2 minutes'
 where file_id in(select id from public.inventory_files where quantity_id='20000000-0000-4000-8000-000000000002');
update public.inventory_files set state='cancelled',validation_lease_until=now()+interval '5 minutes'
 where quantity_id='20000000-0000-4000-8000-000000000001';
update private.file_objects set cleanup_state='eligible' where file_id in
 (select id from public.inventory_files where quantity_id='20000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000001'),
 '{"outstanding":1,"blocked":1}'::jsonb,'terminal bytes behind grace are outstanding despite no visible card');
select is(pg_temp.claim('20000000-0000-4000-8000-000000000001'),'[]'::jsonb,'grace batch is empty and cannot return unrelated prior claims');
reset role;
select is((select state from public.inventory_files where quantity_id='20000000-0000-4000-8000-000000000002'),'reserved','scoped expiry never changes unrelated pending audit file');
select is((select cleanup_state from private.file_objects where file_id in(select id from public.inventory_files where quantity_id='20000000-0000-4000-8000-000000000002')),'claimed','unrelated old claim remains untouched');
update public.inventory_files set validation_lease_until=now()-interval '31 seconds' where quantity_id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select is(jsonb_array_length(pg_temp.claim('20000000-0000-4000-8000-000000000001')),1,'only exact owned parent becomes claimable after grace');
select is(public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000003'),
 '{"outstanding":0,"blocked":0}'::jsonb,'another empty parent remains an authorized no-work result');
select throws_ok($$select public.inventory_file_cleanup_claim(20,'cp5testkey',null,null,null)$$,
 'P1014','file_cleanup_requires_current_application','legacy global maintenance entry is closed');
reset role;
select ok(not has_function_privilege('authenticated','private.file_reserve_ready(text,uuid,bigint,text,text,bigint,uuid,bigint)','EXECUTE'),'client cannot bypass signed reservation via private helper');
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000003')$$,'P1001','forbidden','viewer cannot get empty cleanup success');
reset role;
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
select throws_ok($$select public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000003')$$,'P1001','forbidden','inactive staff cannot get empty cleanup success');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select throws_ok($$select public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000003')$$,'P1001','forbidden','anonymous empty lookup is not authorized');
-- Controlled metadata fixtures check the status predicate; physical ready
-- object preservation/deletion is separately proved by real Storage tests.
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
insert into public.quantity_items(id,name,category_id) values
 ('20000000-0000-4000-8000-000000000004','Ready photo',(select id from public.categories limit 1));
insert into public.serialized_assets(id,name,category_id,location_id) values
 ('30000000-0000-4000-8000-000000000001','Ready PDF',(select id from public.categories limit 1),(select id from public.locations where active and can_hold_inventory limit 1));
insert into public.inventory_files(id,quantity_id,uploader_id,original_name,display_title,declared_type,declared_bytes,purpose,reviewed_collection_revision,source_path,reserve_expires_at,state,validation_generation)
 values('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','ready.png','ready.png','image/png',16,'recognition_photo',1,'fixture/photo-source',now(),'ready',1);
insert into private.file_objects(file_id,variant,path,bytes,cleanup_state)
 values('40000000-0000-4000-8000-000000000001','source','fixture/photo-source',16,'eligible');
insert into private.file_objects(file_id,variant,generation,path,cleanup_state,bytes) select id,variant,generation,path,objects.state,16
 from public.inventory_files cross join (values
 ('display',1,'fixture/current-display','held'),('thumbnail',1,'fixture/current-thumbnail','held'),
 ('display',0,'fixture/obsolete-display','eligible')) objects(variant,generation,path,state)
 where quantity_id='20000000-0000-4000-8000-000000000004';
insert into public.inventory_files(id,asset_id,uploader_id,original_name,display_title,declared_type,declared_bytes,purpose,reviewed_collection_revision,source_path,reserve_expires_at,state)
 values('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ready.pdf','ready.pdf','application/pdf',16,'asset_document',1,'fixture/pdf-source',now(),'ready');
insert into private.file_objects(file_id,variant,path,bytes)
 values('40000000-0000-4000-8000-000000000002','source','fixture/pdf-source',16);
set local role authenticated;
select is(public.inventory_file_cleanup_status('asset','30000000-0000-4000-8000-000000000001'),'{"outstanding":0,"blocked":0}'::jsonb,'ready PDF source is protected and not outstanding cleanup');
select is(public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000004'),'{"outstanding":2,"blocked":0}'::jsonb,'ready current photo variants excluded; original and obsolete generation remain work');
reset role;
update private.file_objects set cleanup_state='deleted',deleted_at=now() where cleanup_state='eligible' and file_id in
 (select id from public.inventory_files where quantity_id='20000000-0000-4000-8000-000000000004');
set local role authenticated;
select is(public.inventory_file_cleanup_status('quantity','20000000-0000-4000-8000-000000000004'),'{"outstanding":0,"blocked":0}'::jsonb,'permanent deleted tombstones do not leave false outstanding work');
reset role;
select * from finish();
rollback;
