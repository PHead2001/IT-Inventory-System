begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege('authenticated',
 'private.inventory_file_storage_completion_guard()','EXECUTE'),
 'completion guard remains trigger-only and not callable by authenticated clients');

-- Exercise the actual completion trigger function without needing to write
-- physical Storage bytes. The real Storage HTTP response is covered by the
-- Files integration suite against the local Storage service.
create temporary table file_completion_probe (
 id uuid, bucket_id text, name text, owner text, owner_id text,
 metadata jsonb, user_metadata jsonb, version text,
 created_at timestamptz, archived_at timestamptz,
 is_delete_marker boolean, is_versioned boolean,
 last_accessed_at timestamptz
);
insert into file_completion_probe(id,bucket_id,name,owner,owner_id,metadata,
 user_metadata,version,created_at,is_delete_marker,is_versioned)
values(gen_random_uuid(),'inventory-files','s/fictional-sealed-path',
 '00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000001',
 '{"size":16}'::jsonb,'{}'::jsonb,'1',now(),false,false);
create trigger file_completion_probe_guard before insert or update
 on file_completion_probe for each row
 execute function private.inventory_file_storage_completion_guard();

select throws_ok($$update file_completion_probe set metadata='{"size":17}'::jsonb$$,
 '42501','immutable_file_storage_object',
 'a privileged content change at a sealed Storage path is an authorization denial');
select lives_ok($$update file_completion_probe set last_accessed_at=now()$$,
 'the unchanged object may still receive an access timestamp');
select is((select metadata->>'size' from file_completion_probe),'16',
 'denied content update does not alter the stored object metadata');

select * from finish();
rollback;
