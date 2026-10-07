// Assembles additive overrides from canonical predecessors without modifying them.
import { readFileSync, writeFileSync } from 'node:fs';
const original = readFileSync(
  'supabase/migrations/20260925000100_published_metadata.sql',
  'utf8',
);
const save = readFileSync(
  'supabase/migrations/20260928212720_metadata_form_save.sql',
  'utf8',
);
const batchReads = readFileSync(
  'supabase/migrations/20260925003000_metadata_batch_reads.sql',
  'utf8',
);
const extract = (source, name) => {
  const start =
    source.indexOf(`create function ${name}(`) >= 0
      ? source.indexOf(`create function ${name}(`)
      : source.indexOf(`create or replace function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  return source
    .slice(start, source.indexOf('$$;', start) + 3)
    .replace('create function ', 'create or replace function ');
};
let rules = extract(original, 'private.metadata_validate_rules')
  .replace(
    "when kind='multi_select' then array['maxSelections']",
    "when kind='multi_select' then array['maxSelections']\n    when kind='boolean' then array['booleanPresentation']",
  )
  .replace(
    "  if kind in ('short_text','long_text') then",
    "  if kind='boolean' and rules ? 'booleanPresentation' and\n    (jsonb_typeof(rules->'booleanPresentation') is distinct from 'string' or\n      rules->>'booleanPresentation' not in ('checkbox','yes_no')) then\n    raise exception using errcode='P1021',message='invalid_boolean_presentation'; end if;\n  if kind in ('short_text','long_text') then",
  );
const duplicate = `    -- Reject only fresh publication; historical immutable revisions remain untouched.
    select choice.parent_option_id into parent_uuid from public.form_revision_options choice
      where choice.revision_id=rev and choice.field_id=field_uuid and choice.active
      group by choice.parent_option_id,private.metadata_option_label_key(choice.label) collate "C"
      having count(*)>1 limit 1;
    if found then
      raise exception using errcode='P1021',message='ambiguous_active_sibling_options',
        detail='Field "'||(f->>'label')||'", path '||coalesce(array_to_string(
          private.metadata_option_path(rev,field_uuid,parent_uuid),' / '),'Root choices')||
          ': active siblings need distinguishable labels. Field ID '||field_uuid::text;
    end if;
`;
let compile = extract(save, 'private.metadata_compile_form').replace(
  "    if kind<>'hierarchical_select'",
  duplicate + "    if kind<>'hierarchical_select'",
);
let consequential = extract(
  save,
  'private.metadata_rules_consequential',
).replace(
  '    old_value:=before_rules->>k;',
  "    if kind='boolean' and k='booleanPresentation' then continue; end if;\n    old_value:=before_rules->>k;",
);
// One bounded field map per call; never repeat Unicode folding for each answer.
// The map is local to this read and the exact immutable validation revision.
const paths = `create function private.metadata_option_paths(rev uuid, field uuid, selected uuid[]) returns jsonb
language plpgsql stable set search_path='' as $$
declare labels jsonb; answer uuid; current_id uuid; node jsonb; path text[];
  paths jsonb:='[]'::jsonb; path_json jsonb; path_bytes integer:=2; option_count integer;
begin
  if selected is null or cardinality(selected)>1000 then
    raise exception using errcode='P1022',message='selection_resource_limit'; end if;
  if cardinality(selected)=0 then return paths; end if;
  select count(*) into option_count from (
    select 1 from public.form_revision_options where revision_id=rev and field_id=field limit 1001
  ) bounded;
  if option_count>1000 then raise exception using errcode='P1022',message='option_resource_limit'; end if;
  -- Each stored label is already bounded to 200 characters. At most 1000 are
  -- normalized once, even when all 1000 answers are requested.
  with keyed as materialized (
    select choice.option_id,choice.parent_option_id,choice.label,choice.active,
      private.metadata_option_label_key(choice.label) collate "C" label_key
    from public.form_revision_options choice where choice.revision_id=rev and choice.field_id=field
  ), counted as (
    select *,count(*) filter(where active) over(partition by parent_option_id,label_key) sibling_count from keyed
  ) select coalesce(jsonb_object_agg(option_id::text,jsonb_build_object(
    'parent',parent_option_id,'label',label || case when active and sibling_count>1
      then ' [choice '||option_id::text||']' else '' end)),'{}'::jsonb)
    into labels from counted;
  foreach answer in array selected loop
    path:=null; current_id:=answer;
    for depth in 1..64 loop
      exit when current_id is null;
      node:=labels->current_id::text;
      exit when node is null;
      path:=array_prepend(node->>'label',path);
      current_id:=(node->>'parent')::uuid;
    end loop;
    if current_id is not null and node is not null then
      raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    path_json:=coalesce(to_jsonb(path),'null'::jsonb);
    -- The old complete description boundary is 2096640 bytes. Check before
    -- appending so oversized paths fail explicitly instead of returning partial data.
    path_bytes:=path_bytes+octet_length(path_json::text)+case when jsonb_array_length(paths)>0 then 2 else 0 end;
    if path_bytes>2096640 then
      raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
    paths:=paths||jsonb_build_array(path_json);
  end loop;
  return paths;
end;
$$;
revoke all on function private.metadata_option_paths(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;

-- Preserve the established scalar signature for compiler guidance and callers.
create or replace function private.metadata_option_path(rev uuid, field uuid, selected uuid) returns text[]
language plpgsql stable set search_path='' as $$
declare paths jsonb;
begin
  if selected is null then return null; end if;
  paths:=private.metadata_option_paths(rev,field,array[selected]);
  if paths->0='null'::jsonb then return null; end if;
  return array(select jsonb_array_elements_text(paths->0));
end;
$$;`;
const describe = extract(original, 'public.metadata_describe_values').replace(
  /      for choice in select x from jsonb_array_elements\(entry->'value'\) x loop[\s\S]*?      end loop;/,
  `      paths:=private.metadata_option_paths(rev,field_uuid,
        array(select (selected_choice.value#>>'{}')::uuid
          from jsonb_array_elements(entry->'value') selected_choice(value)));`,
);
const history = extract(
  batchReads,
  'public.metadata_event_custom_page',
).replace(
  /      for option_value in select v.value from jsonb_array_elements\(entry->'value'\)[\s\S]*?      end loop;/,
  `      -- Preserve the existing 16-path page, not a limit on stored answers.
      paths:=private.metadata_option_paths(chosen_revision,field_uuid,array(
        select (v.value#>>'{}')::uuid from jsonb_array_elements(entry->'value')
          with ordinality as v(value,position) where v.position>p_option_offset
          order by v.position limit 16));
      if octet_length(paths::text)>1500000 then
        raise exception using errcode='P1025',message='metadata_history_page_too_large'; end if;`,
);
const output = process.argv[2];
if (
  !output?.startsWith('supabase/migrations/') ||
  !output.endsWith('_metadata_choice_integrity_presentation.sql')
)
  throw new Error('Pass the migration created by supabase migration new.');
writeFileSync(
  output,
  '-- Audit 2: additive publication integrity and compatible boolean presentation.\n-- No historical definitions, option identities, answers, or membership boundaries are rewritten.\n\n' +
    readFileSync('data/unicode/option-casefold-15.1.sql', 'utf8') +
    '\n' +
    [rules, compile, consequential, paths, describe, history].join('\n\n') +
    '\n',
);
