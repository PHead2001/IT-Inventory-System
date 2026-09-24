-- Published forms are immutable snapshots. Draft JSON is intentionally permissive;
-- publication is the sole point at which it becomes an executable data contract.
create table public.metadata_fields (
  id uuid primary key,
  category_id uuid not null references public.categories(id) on delete restrict,
  field_type text not null check (field_type in
    ('short_text','long_text','integer','decimal','boolean','date','datetime','url',
     'currency','single_select','multi_select','hierarchical_select')),
  created_at timestamptz not null default now(),
  unique(id,category_id)
);
create table public.metadata_options (
  id uuid primary key,
  field_id uuid not null references public.metadata_fields(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(id,field_id)
);
create table public.category_form_revisions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete restrict,
  status text not null check(status in ('draft','published')),
  revision_number bigint not null check(revision_number>0),
  draft_version bigint not null default 1 check(draft_version>0),
  draft_definition jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_by uuid references public.app_members(user_id) on delete restrict,
  unique(category_id,revision_number),
  check(category_id is not null or (status='published' and revision_number=1)),
  check((status='draft' and published_at is null) or
        (status='published' and published_at is not null))
);
create unique index category_one_form_draft on public.category_form_revisions(category_id) where status='draft';
alter table public.categories add column published_form_revision_id uuid;
alter table public.categories add constraint category_published_form_same_category
  foreign key(published_form_revision_id)
  references public.category_form_revisions(id) deferrable initially deferred;
create table public.form_revision_fields (
  revision_id uuid not null references public.category_form_revisions(id) on delete restrict,
  field_id uuid not null references public.metadata_fields(id) on delete restrict,
  label text not null check(length(label) between 1 and 200),
  help text check(length(help)<=2000),
  applies_to text[] not null check(applies_to<@array['quantity','asset']::text[] and cardinality(applies_to)>0),
  required boolean not null,
  default_value jsonb,
  rules jsonb not null default '{}'::jsonb check(jsonb_typeof(rules)='object'),
  sort_order integer not null,
  primary key(revision_id,field_id)
);
create table public.form_revision_options (
  revision_id uuid not null,
  field_id uuid not null,
  option_id uuid not null,
  parent_option_id uuid,
  label text not null check(length(label) between 1 and 200),
  active boolean not null default true,
  sort_order integer not null,
  primary key(revision_id,field_id,option_id),
  foreign key(revision_id,field_id) references public.form_revision_fields(revision_id,field_id) on delete restrict,
  foreign key(option_id,field_id) references public.metadata_options(id,field_id) on delete restrict,
  foreign key(revision_id,field_id,parent_option_id)
    references public.form_revision_options(revision_id,field_id,option_id) deferrable initially deferred
);
create table public.form_revision_sections (
  revision_id uuid not null references public.category_form_revisions(id) on delete restrict,
  id uuid not null,
  label text not null check(length(label) between 1 and 200),
  sort_order integer not null,
  primary key(revision_id,id)
);
create table public.form_revision_controls (
  revision_id uuid not null,
  section_id uuid not null,
  control_id uuid not null,
  kind text not null check(kind in ('field','builtin','help')),
  field_id uuid,
  builtin text,
  help text,
  width text not null check(width in ('Auto','3','4','6','8','9','12')),
  sort_order integer not null,
  primary key(revision_id,control_id),
  foreign key(revision_id,section_id) references public.form_revision_sections(revision_id,id) on delete restrict,
  foreign key(revision_id,field_id) references public.form_revision_fields(revision_id,field_id) on delete restrict,
  check((kind='field' and field_id is not null and builtin is null and help is null)
     or (kind='builtin' and field_id is null and builtin is not null and help is null)
     or (kind='help' and field_id is null and builtin is null and help is not null))
);
create unique index form_control_one_field on public.form_revision_controls(revision_id,field_id) where field_id is not null;
create unique index form_control_one_builtin on public.form_revision_controls(revision_id,builtin) where builtin is not null;
create table private.form_impact_reviews (
  token uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.app_members(user_id) on delete restrict,
  category_id uuid not null,
  draft_id uuid not null,
  draft_version bigint not null,
  published_id uuid,
  affected_quantity bigint not null,
  affected_assets bigint not null,
  reference_fingerprint text not null,
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes')
);
create table public.form_publication_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.app_members(user_id) on delete restrict,
  actor_name text not null,
  category_id uuid not null references public.categories(id) on delete restrict,
  revision_id uuid not null references public.category_form_revisions(id) on delete restrict,
  previous_revision_id uuid,
  affected_quantity bigint not null,
  affected_assets bigint not null,
  created_at timestamptz not null default now()
);
create trigger form_publication_events_append_only before update or delete on public.form_publication_events
  for each row execute function private.inventory_append_only();

alter table public.quantity_items add column custom_values jsonb not null default '{}'::jsonb,
  add column validated_form_revision_id uuid references public.category_form_revisions(id) on delete restrict,
  add column needs_metadata boolean not null default false,
  add constraint quantity_custom_object check(jsonb_typeof(custom_values)='object' and octet_length(custom_values::text)<=262144);
alter table public.serialized_assets add column custom_values jsonb not null default '{}'::jsonb,
  add column validated_form_revision_id uuid references public.category_form_revisions(id) on delete restrict,
  add column needs_metadata boolean not null default false,
  add constraint asset_custom_object check(jsonb_typeof(custom_values)='object' and octet_length(custom_values::text)<=262144);

create function private.metadata_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='category_form_revisions' then
    if old.status='published' then raise exception using errcode='P1020',message='published_form_immutable'; end if;
  elsif exists(select 1 from public.category_form_revisions r where r.id=old.revision_id and r.status='published') then
    raise exception using errcode='P1020',message='published_form_immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger form_revision_immutable before update or delete on public.category_form_revisions
  for each row execute function private.metadata_immutable();
create trigger form_fields_immutable before update or delete on public.form_revision_fields
  for each row execute function private.metadata_immutable();
create trigger form_options_immutable before update or delete on public.form_revision_options
  for each row execute function private.metadata_immutable();
create trigger form_sections_immutable before update or delete on public.form_revision_sections
  for each row execute function private.metadata_immutable();
create trigger form_controls_immutable before update or delete on public.form_revision_controls
  for each row execute function private.metadata_immutable();
create function private.metadata_identity_immutable() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='P1020',message='metadata_identity_immutable';
  end if;
  if new.id is distinct from old.id or
     (tg_table_name='metadata_fields' and (new.category_id is distinct from old.category_id or new.field_type is distinct from old.field_type)) or
     (tg_table_name='metadata_options' and new.field_id is distinct from old.field_id) then
    raise exception using errcode='P1020',message='metadata_identity_immutable';
  end if;
  return new;
end;
$$;
create trigger metadata_fields_identity before update or delete on public.metadata_fields
  for each row execute function private.metadata_identity_immutable();
create trigger metadata_options_identity before update or delete on public.metadata_options
  for each row execute function private.metadata_identity_immutable();

-- An untouched category references one shared immutable canonical baseline.
-- A category-owned revision exists only after a maintainer authors a draft.
create unique index one_shared_form_baseline on public.category_form_revisions((true))
  where category_id is null;
create function private.metadata_seed_form() returns uuid language plpgsql set search_path='' as $$
declare rev uuid:=gen_random_uuid(); section_id uuid:=gen_random_uuid();
  name_control uuid:=gen_random_uuid(); category_control uuid:=gen_random_uuid();
  description_control uuid:=gen_random_uuid(); manufacturer_control uuid:=gen_random_uuid();
  model_control uuid:=gen_random_uuid(); threshold_control uuid:=gen_random_uuid();
  tag_control uuid:=gen_random_uuid(); serial_control uuid:=gen_random_uuid();
begin
  insert into public.category_form_revisions(id,category_id,status,revision_number,published_at,draft_definition)
    values(rev,null,'published',1,now(),jsonb_build_object('fields','[]'::jsonb,'layout',
      jsonb_build_array(jsonb_build_object('id',section_id,'label','Details','controls',
        jsonb_build_array(jsonb_build_object('id',name_control,'kind','builtin','builtin','name','width',12),
          jsonb_build_object('id',category_control,'kind','builtin','builtin','category_id','width',12),
          jsonb_build_object('id',manufacturer_control,'kind','builtin','builtin','manufacturer','width',6),
          jsonb_build_object('id',model_control,'kind','builtin','builtin','model','width',6),
          jsonb_build_object('id',threshold_control,'kind','builtin','builtin','reorder_threshold','width',6),
          jsonb_build_object('id',description_control,'kind','builtin','builtin','description','width',12),
          jsonb_build_object('id',tag_control,'kind','builtin','builtin','asset_tag','width',6),
          jsonb_build_object('id',serial_control,'kind','builtin','builtin','serial_number','width',6))))));
  insert into public.form_revision_sections values(rev,section_id,'Details',0);
  insert into public.form_revision_controls(revision_id,section_id,control_id,kind,builtin,width,sort_order)
    values(rev,section_id,name_control,'builtin','name','12',0),
          (rev,section_id,category_control,'builtin','category_id','12',1),
          (rev,section_id,manufacturer_control,'builtin','manufacturer','6',2),
          (rev,section_id,model_control,'builtin','model','6',3),
          (rev,section_id,threshold_control,'builtin','reorder_threshold','6',4),
          (rev,section_id,description_control,'builtin','description','12',5),
          (rev,section_id,tag_control,'builtin','asset_tag','6',6),
          (rev,section_id,serial_control,'builtin','serial_number','6',7);
  update public.categories set published_form_revision_id=rev;
  return rev;
end;
$$;
select private.metadata_seed_form();
create function private.metadata_seed_category() returns trigger language plpgsql set search_path='' as $$
begin
  update public.categories set published_form_revision_id=
    (select id from public.category_form_revisions where category_id is null)
    where id=new.id;
  return new;
end;
$$;
create trigger category_seed_form after insert on public.categories
  for each row execute function private.metadata_seed_category();

create function private.metadata_category_pointer_valid() returns trigger
language plpgsql set search_path='' as $$
declare selected uuid;
begin
  -- The seed trigger updates a newly inserted category in the same transaction.
  select published_form_revision_id into selected from public.categories where id=new.id;
  if not found then return new; end if;
  if selected is null or not exists(
    select 1 from public.category_form_revisions r where r.id=selected
      and r.status='published' and (r.category_id is null or r.category_id=new.id)
  ) then raise exception using errcode='P1020',message='invalid_category_form_pointer'; end if;
  return new;
end;
$$;
create constraint trigger category_form_pointer_valid
  after insert or update of published_form_revision_id on public.categories
  deferrable initially deferred for each row
  execute function private.metadata_category_pointer_valid();

-- Row visibility follows membership; all writes are through guarded RPCs.
alter table public.metadata_fields enable row level security;
alter table public.metadata_options enable row level security;
alter table public.category_form_revisions enable row level security;
alter table public.form_revision_fields enable row level security;
alter table public.form_revision_options enable row level security;
alter table public.form_revision_sections enable row level security;
alter table public.form_revision_controls enable row level security;
alter table public.form_publication_events enable row level security;
create policy metadata_fields_read on public.metadata_fields for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
create policy metadata_options_read on public.metadata_options for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
create policy form_revisions_read on public.category_form_revisions for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active
    and (status='published' or (role='staff' and can_manage_configuration))));
create policy form_fields_read on public.form_revision_fields for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
create policy form_options_read on public.form_revision_options for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
create policy form_sections_read on public.form_revision_sections for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
create policy form_controls_read on public.form_revision_controls for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
create policy form_publications_read on public.form_publication_events for select to authenticated
  using(exists(select 1 from public.app_members where user_id=(select auth.uid()) and active));
revoke all on public.metadata_fields,public.metadata_options,public.category_form_revisions,
  public.form_revision_fields,public.form_revision_options,public.form_revision_sections,
  public.form_revision_controls,public.form_publication_events from public,anon,authenticated;
grant select on public.metadata_fields,public.metadata_options,public.category_form_revisions,
  public.form_revision_fields,public.form_revision_options,public.form_revision_sections,
  public.form_revision_controls,public.form_publication_events to authenticated;
grant all on public.metadata_fields,public.metadata_options,public.category_form_revisions,
  public.form_revision_fields,public.form_revision_options,public.form_revision_sections,
  public.form_revision_controls,public.form_publication_events to service_role;
revoke all on private.form_impact_reviews from public,anon,authenticated;

-- The database interprets only fixed rule keys. No expression, script, HTML,
-- regex supplied by a maintainer, or client-supplied validation claim executes.
-- Pinned from SIX ISO 4217 List One (published 2026-09-17).
-- https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml
create function private.metadata_currency_code_valid(code text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(code=any(array['AED','AFN','ALL','AMD','AOA','ARS','AUD','AWG','AZN','BAM','BBD','BDT','BHD','BIF','BMD','BND','BOB','BOV','BRL','BSD','BTN','BWP','BYN','BZD','CAD','CDF','CHE','CHF','CHW','CLF','CLP','CNY','COP','COU','CRC','CUP','CVE','CZK','DJF','DKK','DOP','DZD','EGP','ERN','ETB','EUR','FJD','FKP','GBP','GEL','GHS','GIP','GMD','GNF','GTQ','GYD','HKD','HNL','HTG','HUF','IDR','ILS','INR','IQD','IRR','ISK','JMD','JOD','JPY','KES','KGS','KHR','KMF','KPW','KRW','KWD','KYD','KZT','LAK','LBP','LKR','LRD','LSL','LYD','MAD','MDL','MGA','MKD','MMK','MNT','MOP','MRU','MUR','MVR','MWK','MXN','MXV','MYR','MZN','NAD','NGN','NIO','NOK','NPR','NZD','OMR','PAB','PEN','PGK','PHP','PKR','PLN','PYG','QAR','RON','RSD','RUB','RWF','SAR','SBD','SCR','SDG','SEK','SGD','SHP','SLE','SOS','SRD','SSP','STN','SVC','SYP','SZL','THB','TJS','TMT','TND','TOP','TRY','TTD','TWD','TZS','UAH','UGX','USD','USN','UYI','UYU','UYW','UZS','VED','VES','VND','VUV','WST','XAD','XAF','XAG','XAU','XBA','XBB','XBC','XBD','XCD','XCG','XDR','XOF','XPD','XPF','XPT','XSU','XTS','XUA','XXX','YER','ZAR','ZMW','ZWG']::text[]),false);
$$;

create function private.metadata_value_valid(rev uuid, field uuid, value jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare cfg public.form_revision_fields%rowtype; kind text; raw text; digits text;
  n numeric; limit_min numeric; limit_max numeric; options uuid[]; selected_option uuid;
  currency text; parsed_time timestamptz;
begin
  select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field;
  if not found or value is null or value='null'::jsonb then return false; end if;
  select field_type into kind from public.metadata_fields where id=field;
  if kind in ('short_text','long_text','url','date','datetime','decimal') then
    if jsonb_typeof(value)<>'string' then return false; end if;
    raw:=value#>>'{}';
  end if;
  if kind in ('short_text','long_text') then
    return length(raw)<=case when kind='short_text' then 500 else 10000 end
      and length(raw)>=coalesce((cfg.rules->>'minLength')::integer,0)
      and length(raw)<=coalesce((cfg.rules->>'maxLength')::integer,case when kind='short_text' then 500 else 10000 end);
  elsif kind='integer' then
    if jsonb_typeof(value)<>'number' then return false; end if;
    n:=(value#>>'{}')::numeric;
    return n=trunc(n) and abs(n)<=9007199254740991
      and n>=coalesce((cfg.rules->>'min')::numeric,-9007199254740991)
      and n<=coalesce((cfg.rules->>'max')::numeric,9007199254740991);
  elsif kind='decimal' then
    if raw !~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$' then return false; end if;
    digits:=regexp_replace(raw,'[^0-9]','','g');
    if length(digits)>24 or length(coalesce(split_part(raw,'.',2),''))>
      coalesce((cfg.rules->>'precision')::integer,6) then return false; end if;
    n:=raw::numeric;
    return n>=coalesce((cfg.rules->>'min')::numeric,-999999999999999999999999::numeric)
      and n<=coalesce((cfg.rules->>'max')::numeric,999999999999999999999999::numeric);
  elsif kind='boolean' then
    return jsonb_typeof(value)='boolean';
  elsif kind='date' then
    if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return false; end if;
    begin
      return to_char(raw::date,'YYYY-MM-DD')=raw
        and (cfg.rules->>'min' is null or raw>=cfg.rules->>'min')
        and (cfg.rules->>'max' is null or raw<=cfg.rules->>'max');
    exception when others then return false; end;
  elsif kind='datetime' then
    if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' then return false; end if;
    begin
      if to_char(split_part(raw,'T',1)::date,'YYYY-MM-DD')<>split_part(raw,'T',1)
        or substring(raw from 12 for 2)::integer>23
        or substring(raw from 15 for 2)::integer>59
        or substring(raw from 18 for 2)::integer>59
        or substring(raw from '[+-]([0-9]{2}):[0-9]{2}$')::integer>23
        or substring(raw from '[+-][0-9]{2}:([0-9]{2})$')::integer>59 then
        return false; end if;
      parsed_time:=raw::timestamptz;
      return (cfg.rules->>'min' is null or parsed_time >= (cfg.rules->>'min')::timestamptz)
        and (cfg.rules->>'max' is null or parsed_time <= (cfg.rules->>'max')::timestamptz);
    exception when others then return false; end;
  elsif kind='url' then
    return length(raw)<=2048
      and raw ~ '^https?://[^/?#@:[:space:]]+(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
      and raw !~ '[[:cntrl:]]';
  elsif kind='currency' then
    if jsonb_typeof(value)<>'object' or value ?& array['amount','currency']=false
       or (select count(*) from jsonb_object_keys(value))<>2
       or jsonb_typeof(value->'amount')<>'string' or jsonb_typeof(value->'currency')<>'string' then return false; end if;
    currency:=value->>'currency'; raw:=value->>'amount';
    if not private.metadata_currency_code_valid(currency) or currency<>cfg.rules->>'currencyCode'
      or raw !~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,4})?$' then return false; end if;
    digits:=regexp_replace(raw,'[^0-9]','','g');
    if length(digits)>24 or length(split_part(raw,'.',2))>(cfg.rules->>'precision')::integer then return false; end if;
    n:=raw::numeric;
    return n>=coalesce((cfg.rules->>'min')::numeric,-999999999999999999999999::numeric)
      and n<=coalesce((cfg.rules->>'max')::numeric,999999999999999999999999::numeric);
  elsif kind in ('single_select','hierarchical_select') then
    if jsonb_typeof(value)<>'string' or (value#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
    begin selected_option:=(value#>>'{}')::uuid; exception when others then return false; end;
    return exists(select 1 from public.form_revision_options where revision_id=rev
      and field_id=field and option_id=selected_option and active);
  elsif kind='multi_select' then
    if jsonb_typeof(value)<>'array' or jsonb_array_length(value)>
       coalesce((cfg.rules->>'maxSelections')::integer,1000) then return false; end if;
    if exists(select 1 from jsonb_array_elements(value) x where jsonb_typeof(x)<>'string'
      or (x#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') then return false; end if;
    select array_agg((x#>>'{}')::uuid) into options from jsonb_array_elements(value) x;
    if options is null then return true; end if;
    return cardinality(options)=(select count(distinct x) from unnest(options) x)
      and not exists(select 1 from unnest(options) x where not exists
        (select 1 from public.form_revision_options o where o.revision_id=rev
         and o.field_id=field and o.option_id=x and o.active));
  end if;
  return false;
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format then
  return false;
end;
$$;

create function private.metadata_canonical_value(rev uuid, field uuid, value jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare kind text; utc text;
begin
  select field_type into kind from public.metadata_fields where id=field;
  if kind='datetime' then
    utc:=to_char((value#>>'{}')::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
    return to_jsonb(utc);
  end if;
  return value;
end;
$$;

create function private.metadata_validate_rules(kind text, rules jsonb) returns void
language plpgsql set search_path='' as $$
declare allowed text[]; key text; min_value numeric; max_value numeric; bound text;
  precision_value integer;
begin
  if rules is null or jsonb_typeof(rules)<>'object' then raise exception using errcode='P1021',message='invalid_form_rules'; end if;
  allowed:=case
    when kind in ('short_text','long_text') then array['minLength','maxLength']
    when kind in ('integer','decimal','currency') then array['min','max','precision','currencyCode']
    when kind in ('date','datetime') then array['min','max']
    when kind='multi_select' then array['maxSelections']
    else array[]::text[] end;
  for key in select jsonb_object_keys(rules) loop
    if not key=any(allowed) then raise exception using errcode='P1021',message='unsupported_form_rule'; end if;
  end loop;
  if kind in ('short_text','long_text') then
    if exists(select 1 from jsonb_each(rules) x where x.value::text !~ '^[0-9]+$'
      or length(x.value::text)>5) then
      raise exception using errcode='P1021',message='invalid_form_rules'; end if;
    if coalesce((rules->>'minLength')::integer,0)>coalesce((rules->>'maxLength')::integer,
      case when kind='short_text' then 500 else 10000 end)
      or coalesce((rules->>'maxLength')::integer,0)>case when kind='short_text' then 500 else 10000 end then
      raise exception using errcode='P1021',message='invalid_form_rules'; end if;
  elsif kind in ('integer','decimal','currency') then
    if kind='integer' and (rules ? 'precision' or rules ? 'currencyCode') then
      raise exception using errcode='P1021',message='invalid_form_rules'; end if;
    if kind='decimal' and rules ? 'currencyCode' then raise exception using errcode='P1021',message='invalid_form_rules'; end if;
    if kind='currency' and not private.metadata_currency_code_valid(rules->>'currencyCode') then
      raise exception using errcode='P1021',message='invalid_currency'; end if;
    if rules ? 'precision' and (jsonb_typeof(rules->'precision') is distinct from 'number' or
      (rules->>'precision') !~ '^[0-9]$' or
      (rules->>'precision')::integer>case when kind='currency' then 4 else 6 end) then
      raise exception using errcode='P1021',message='invalid_precision'; end if;
    if kind='currency' and not rules ? 'precision' then raise exception using errcode='P1021',message='missing_currency_precision'; end if;
    if rules ? 'min' and not coalesce((rules->>'min') ~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$',false) then
      raise exception using errcode='P1021',message='invalid_minimum'; end if;
    if rules ? 'max' and not coalesce((rules->>'max') ~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$',false) then
      raise exception using errcode='P1021',message='invalid_maximum'; end if;
    precision_value:=coalesce((rules->>'precision')::integer,6);
    for bound in select value from (values(rules->>'min'),(rules->>'max')) x(value)
      where value is not null loop
      if length(regexp_replace(bound,'[^0-9]','','g'))>24 or
        length(split_part(bound,'.',2))>precision_value then
        raise exception using errcode='P1021',message='inconsistent_numeric_bounds'; end if;
    end loop;
    min_value:=(rules->>'min')::numeric; max_value:=(rules->>'max')::numeric;
    if min_value>max_value then raise exception using errcode='P1021',message='inverted_bounds'; end if;
    if kind='integer' and (min_value<>trunc(min_value) or max_value<>trunc(max_value)
      or abs(coalesce(min_value,0))>9007199254740991 or abs(coalesce(max_value,0))>9007199254740991) then
      raise exception using errcode='P1021',message='invalid_integer_bounds'; end if;
  elsif kind='multi_select' then
    if rules ? 'maxSelections' and (jsonb_typeof(rules->'maxSelections') is distinct from 'number'
      or (rules->>'maxSelections') !~ '^[1-9][0-9]{0,3}$'
      or (rules->>'maxSelections')::integer>1000) then raise exception using errcode='P1021',message='invalid_selection_limit'; end if;
  elsif kind in ('date','datetime') then
    if rules ? 'min' and not coalesce(private.metadata_date_bound_valid(kind,rules->>'min'),false) then
      raise exception using errcode='P1021',message='invalid_date_minimum'; end if;
    if rules ? 'max' and not coalesce(private.metadata_date_bound_valid(kind,rules->>'max'),false) then
      raise exception using errcode='P1021',message='invalid_date_maximum'; end if;
    if rules ? 'min' and rules ? 'max' and
      (case when kind='date' then (rules->>'min')::date>(rules->>'max')::date
        else (rules->>'min')::timestamptz>(rules->>'max')::timestamptz end) then
      raise exception using errcode='P1021',message='inverted_bounds'; end if;
  end if;
end;
$$;

create function private.metadata_date_bound_valid(kind text, value text) returns boolean
language plpgsql stable set search_path='' as $$
begin
  if value is null then return false; end if;
  if kind='date' then
    return value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and to_char(value::date,'YYYY-MM-DD')=value;
  end if;
  return value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$'
    and to_char(split_part(value,'T',1)::date,'YYYY-MM-DD')=split_part(value,'T',1)
    and substring(value from 12 for 2)::integer<=23
    and substring(value from 15 for 2)::integer<=59
    and substring(value from 18 for 2)::integer<=59
    and coalesce(substring(value from '[+-]([0-9]{2}):[0-9]{2}$')::integer,0)<=23
    and coalesce(substring(value from '[+-][0-9]{2}:([0-9]{2})$')::integer,0)<=59
    and value::timestamptz is not null;
exception when others then return false;
end;
$$;

create function private.metadata_compile_form(rev uuid, category uuid, definition jsonb) returns void
language plpgsql set search_path='' as $$
declare f jsonb; o jsonb; s jsonb; c jsonb; field_uuid uuid; option_uuid uuid;
  parent_uuid uuid; section_uuid uuid; control_uuid uuid; kind text; ordinal integer;
  field_count integer; option_count integer:=0; row_count integer; bad_count integer;
begin
  if jsonb_typeof(definition) is distinct from 'object' then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  if not (definition ?& array['fields','layout']) or
    jsonb_typeof(definition->'fields') is distinct from 'array'
    or jsonb_typeof(definition->'layout') is distinct from 'array' or
    (select count(*) from jsonb_object_keys(definition))<>2 then
    raise exception using errcode='P1021',message='invalid_form_shape'; end if;
  field_count:=jsonb_array_length(definition->'fields');
  if field_count>100 or jsonb_array_length(definition->'layout')>100 then
    raise exception using errcode='P1022',message='form_resource_limit'; end if;
  ordinal:=0;
  for f in select value from jsonb_array_elements(definition->'fields') loop
    if jsonb_typeof(f) is distinct from 'object' or
      jsonb_typeof(f->'applies_to') is distinct from 'array' or
      (f ? 'options' and jsonb_typeof(f->'options') is distinct from 'array') then
      raise exception using errcode='P1021',message='invalid_field'; end if;
    if not (f ?& array['id','type','label','applies_to','required']) or
      exists(select 1 from jsonb_object_keys(f) k where k not in
        ('id','type','label','help','applies_to','required','default','rules','options')) or
      not coalesce((f->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false)
      or not coalesce((f->>'type') in ('short_text','long_text','integer','decimal','boolean','date','datetime','url',
        'currency','single_select','multi_select','hierarchical_select')
        ,false)
      or jsonb_typeof(f->'label') is distinct from 'string'
      or not coalesce(length(btrim(f->>'label')) between 1 and 200,false)
      or (f ? 'help' and f->'help'<>'null'::jsonb and
        (jsonb_typeof(f->'help')<>'string' or length(f->>'help')>2000))
      or not coalesce(jsonb_array_length(f->'applies_to') between 1 and 2,false)
      or jsonb_typeof(f->'required') is distinct from 'boolean'
      then
      raise exception using errcode='P1021',message='invalid_field'; end if;
    if exists(select 1 from jsonb_array_elements_text(f->'applies_to') x where x not in ('quantity','asset'))
      or (select count(distinct x) from jsonb_array_elements_text(f->'applies_to') x)<>
         jsonb_array_length(f->'applies_to') then
      raise exception using errcode='P1021',message='invalid_applicability'; end if;
    field_uuid:=(f->>'id')::uuid; kind:=f->>'type';
    if exists(select 1 from public.metadata_fields where id=field_uuid and
      (category_id<>category or field_type<>kind)) then
      raise exception using errcode='P1021',message='field_identity_conflict'; end if;
    insert into public.metadata_fields(id,category_id,field_type) values(field_uuid,category,kind)
      on conflict(id) do nothing;
    perform private.metadata_validate_rules(kind,coalesce(f->'rules','{}'::jsonb));
    if kind='currency' and exists(
      select 1 from public.form_revision_fields prior
      join public.category_form_revisions published on published.id=prior.revision_id
      where prior.field_id=field_uuid and published.status='published'
        and (prior.rules->>'currencyCode' is distinct from f->'rules'->>'currencyCode'
          or prior.rules->>'precision' is distinct from f->'rules'->>'precision')
    ) then raise exception using errcode='P1021',message='currency_meaning_requires_new_field_id'; end if;
    insert into public.form_revision_fields(revision_id,field_id,label,help,applies_to,required,
      default_value,rules,sort_order)
      values(rev,field_uuid,btrim(f->>'label'),nullif(f->>'help',''),
        array(select jsonb_array_elements_text(f->'applies_to')),(f->>'required')::boolean,
        f->'default',coalesce(f->'rules','{}'::jsonb),ordinal);
    row_count:=coalesce(jsonb_array_length(f->'options'),0);
    if row_count>1000 or option_count+row_count>5000 then
      raise exception using errcode='P1022',message='option_resource_limit'; end if;
    if kind not in ('single_select','multi_select','hierarchical_select') and row_count>0 then
      raise exception using errcode='P1021',message='options_on_nonselection'; end if;
    option_count:=option_count+row_count;
    for o in select value from jsonb_array_elements(coalesce(f->'options','[]'::jsonb)) loop
      if jsonb_typeof(o) is distinct from 'object' then
        raise exception using errcode='P1021',message='invalid_option'; end if;
      if not (o ?& array['id','label','active']) or
        exists(select 1 from jsonb_object_keys(o) k where k not in
          ('id','label','parent_id','active')) or
        not coalesce((o->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false)
        or jsonb_typeof(o->'label') is distinct from 'string'
        or not coalesce(length(btrim(o->>'label')) between 1 and 200,false)
        or jsonb_typeof(o->'active') is distinct from 'boolean' or
        (o ? 'parent_id' and o->'parent_id'<>'null'::jsonb and
          not coalesce((o->>'parent_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false)) then
        raise exception using errcode='P1021',message='invalid_option'; end if;
      option_uuid:=(o->>'id')::uuid;
      if exists(select 1 from public.metadata_options where id=option_uuid and field_id<>field_uuid) then
        raise exception using errcode='P1021',message='option_identity_conflict'; end if;
      insert into public.metadata_options(id,field_id) values(option_uuid,field_uuid) on conflict(id) do nothing;
      parent_uuid:=nullif(o->>'parent_id','')::uuid;
      insert into public.form_revision_options(revision_id,field_id,option_id,parent_option_id,label,active,sort_order)
        values(rev,field_uuid,option_uuid,parent_uuid,btrim(o->>'label'),(o->>'active')::boolean,
          (select count(*) from public.form_revision_options where revision_id=rev and field_id=field_uuid));
    end loop;
    if kind<>'hierarchical_select' and exists(select 1 from public.form_revision_options
      where revision_id=rev and field_id=field_uuid and parent_option_id is not null) then
      raise exception using errcode='P1021',message='nonhierarchical_parent'; end if;
    -- Every node must reach a root in at most 64 hops; a cycle cannot pass.
    if kind='hierarchical_select' and exists(
      with recursive walk as (
        select option_id,parent_option_id,array[option_id] visited,1 depth
        from public.form_revision_options where revision_id=rev and field_id=field_uuid
        union all
        select w.option_id,p.parent_option_id,w.visited||p.option_id,w.depth+1
        from walk w join public.form_revision_options p on p.revision_id=rev
          and p.field_id=field_uuid and p.option_id=w.parent_option_id
        where w.parent_option_id is not null and w.depth<65 and not p.option_id=any(w.visited)
      )
      select 1 from walk w where w.depth>64 or
        (w.parent_option_id is not null and (w.parent_option_id=any(w.visited)
          or not exists(select 1 from public.form_revision_options p where p.revision_id=rev
            and p.field_id=field_uuid and p.option_id=w.parent_option_id)))
    ) then raise exception using errcode='P1022',message='option_depth_or_cycle'; end if;
    if f ? 'default' and not private.metadata_value_valid(rev,field_uuid,f->'default') then
      raise exception using errcode='P1021',message='invalid_default'; end if;
    ordinal:=ordinal+1;
  end loop;
  ordinal:=0;
  for s in select value from jsonb_array_elements(definition->'layout') loop
    if jsonb_typeof(s) is distinct from 'object' or
      jsonb_typeof(s->'controls') is distinct from 'array' then
      raise exception using errcode='P1021',message='invalid_section'; end if;
    if not (s ?& array['id','label','controls']) or
      exists(select 1 from jsonb_object_keys(s) k where k not in ('id','label','controls')) or
      not coalesce((s->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false)
      or jsonb_typeof(s->'label') is distinct from 'string'
      or not coalesce(length(btrim(s->>'label')) between 1 and 200,false)
      or coalesce(jsonb_array_length(s->'controls'),0)>200 then
      raise exception using errcode='P1021',message='invalid_section'; end if;
    section_uuid:=(s->>'id')::uuid;
    insert into public.form_revision_sections(revision_id,id,label,sort_order)
      values(rev,section_uuid,btrim(s->>'label'),ordinal);
    row_count:=0;
    for c in select value from jsonb_array_elements(s->'controls') loop
      if jsonb_typeof(c) is distinct from 'object' then
        raise exception using errcode='P1021',message='invalid_control'; end if;
      if not (c ?& array['id','kind','width']) or
        exists(select 1 from jsonb_object_keys(c) k where k not in
          ('id','kind','field_id','builtin','help','width')) or
        not coalesce((c->>'id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false)
        or not coalesce(c->>'kind' in ('field','builtin','help'),false)
        or not ((jsonb_typeof(c->'width')='string' and c->>'width'='Auto')
          or (jsonb_typeof(c->'width')='number' and c->>'width' ~ '^(3|4|6|8|9|12)$')) then
        raise exception using errcode='P1021',message='invalid_control'; end if;
      control_uuid:=(c->>'id')::uuid;
      kind:=c->>'kind';
      if kind='field' and (not coalesce((c->>'field_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false) or
        not exists(select 1 from public.form_revision_fields where revision_id=rev
          and field_id=(c->>'field_id')::uuid)) then
        raise exception using errcode='P1021',message='unknown_layout_field'; end if;
      if kind='builtin' and not coalesce(c->>'builtin' in
        ('name','category_id','description','manufacturer','model','reorder_threshold','asset_tag','serial_number'),false) then
        raise exception using errcode='P1021',message='unsupported_builtin'; end if;
      if kind='help' and (jsonb_typeof(c->'help')<>'string' or length(c->>'help')>2000) then
        raise exception using errcode='P1021',message='invalid_help'; end if;
      insert into public.form_revision_controls(revision_id,section_id,control_id,kind,field_id,builtin,help,width,sort_order)
        values(rev,section_uuid,control_uuid,kind,
          case when kind='field' then (c->>'field_id')::uuid end,
          case when kind='builtin' then c->>'builtin' end,
          case when kind='help' then c->>'help' end,c->>'width',row_count);
      row_count:=row_count+1;
    end loop;
    ordinal:=ordinal+1;
  end loop;
  if (select count(*) from public.form_revision_controls where revision_id=rev and builtin='name')<>1
     or (select count(*) from public.form_revision_controls where revision_id=rev and builtin='category_id')<>1
     or exists(select 1 from public.form_revision_fields f where f.revision_id=rev and f.required
       and not exists(select 1 from public.form_revision_controls c where c.revision_id=rev and c.field_id=f.field_id)) then
    raise exception using errcode='P1021',message='required_control_missing'; end if;
exception when unique_violation then
  raise exception using errcode='P1021',message='duplicate_form_identity';
end;
$$;

create function private.metadata_reference_fingerprint(category uuid) returns text
language sql stable set search_path='' as $$
  select md5(coalesce(string_agg(kind||':'||id::text||':'||version::text,',' order by kind,id),'') )
  from (
    select 'q'::text kind,id,version from public.quantity_items where category_id=category
    union all
    select 'a'::text kind,id,version from public.serialized_assets where category_id=category
  ) x;
$$;

create function public.metadata_draft_save(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected bigint; definition jsonb; draft public.category_form_revisions%rowtype;
  next_number bigint; category_row public.categories%rowtype; raw_version text;
begin
  select display_name into actor_name from public.app_members where user_id=actor
    and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_draft_version','definition']);
  category_id:=private.inventory_uuid(p_payload,'category_id');
  raw_version:=p_payload->>'expected_draft_version';
  if jsonb_typeof(p_payload->'expected_draft_version') not in ('string','number')
    or not coalesce(raw_version ~ '^(0|[1-9][0-9]{0,18})$',false) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  if raw_version::numeric>9223372036854775807 or
    (jsonb_typeof(p_payload->'expected_draft_version')='number'
      and raw_version::numeric>9007199254740991) then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  expected:=raw_version::bigint;
  definition:=p_payload->'definition';
  if definition is null or octet_length(definition::text)>262144 then
    raise exception using errcode='P1022',message='draft_resource_limit'; end if;
  normalized:=jsonb_build_object('category_id',category_id,'expected_draft_version',expected::text,'definition',definition);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_draft_save',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(false);
  select * into category_row from public.categories where id=category_id for share;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions r
    where r.category_id=(p_payload->>'category_id')::uuid and r.status='draft' for update;
  if not found then
    if expected<>0 then raise exception using errcode='P1002',message='stale_draft'; end if;
    select coalesce(max(revision_number),0)+1 into next_number from public.category_form_revisions r
      where r.category_id=(p_payload->>'category_id')::uuid;
    insert into public.category_form_revisions(category_id,status,revision_number,draft_definition)
      values(category_id,'draft',next_number,definition) returning * into draft;
  else
    if draft.draft_version<>expected then raise exception using errcode='P1002',message='stale_draft'; end if;
    update public.category_form_revisions set draft_version=draft_version+1,draft_definition=definition
      where id=draft.id returning * into draft;
  end if;
  replay:=jsonb_build_object('entity_id',draft.id,'version',draft.draft_version::text,
    'draft_id',draft.id,'event_id',null,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

create function public.metadata_draft_discard(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); normalized jsonb; replay jsonb; category_id uuid;
  expected bigint; draft public.category_form_revisions%rowtype;
begin
  perform 1 from public.app_members where user_id=actor and active and role='staff'
    and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_draft_version']);
  category_id:=private.inventory_uuid(p_payload,'category_id');
  expected:=private.configuration_version(p_payload,'expected_draft_version');
  normalized:=jsonb_build_object('category_id',category_id,'expected_draft_version',expected::text);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_draft_discard',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(false);
  perform id from public.categories where id=category_id for share;
  select * into draft from public.category_form_revisions r
    where r.category_id=(p_payload->>'category_id')::uuid and r.status='draft' for update;
  if not found or draft.draft_version<>expected then raise exception using errcode='P1002',message='stale_draft'; end if;
  delete from public.category_form_revisions where id=draft.id;
  replay:=jsonb_build_object('entity_id',draft.id,'version',null,'event_id',null,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

create function public.metadata_publish_review(p_category_id uuid) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); category_row public.categories%rowtype;
  draft public.category_form_revisions%rowtype; token_id uuid; q bigint; a bigint;
begin
  perform 1 from public.app_members where user_id=actor and active and role='staff'
    and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.configuration_catalog_lock(false);
  select * into category_row from public.categories where id=p_category_id for share;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions where category_id=p_category_id and status='draft';
  if not found then raise exception using errcode='P1021',message='no_draft'; end if;
  select count(*) into q from public.quantity_items where category_id=p_category_id;
  select count(*) into a from public.serialized_assets where category_id=p_category_id;
  insert into private.form_impact_reviews(actor_id,category_id,draft_id,draft_version,published_id,
    affected_quantity,affected_assets,reference_fingerprint)
    values(actor,p_category_id,draft.id,draft.draft_version,category_row.published_form_revision_id,
      q,a,private.metadata_reference_fingerprint(p_category_id)) returning token into token_id;
  return jsonb_build_object('token',token_id,'category_id',p_category_id,'draft_id',draft.id,
    'draft_version',draft.draft_version::text,'published_revision_id',category_row.published_form_revision_id,
    'affected_quantity',q::text,'affected_assets',a::text,
    'expires_at',clock_timestamp()+interval '15 minutes');
end;
$$;

create function public.metadata_publish(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_id uuid; expected bigint; expected_published uuid; review_token uuid;
  category_row public.categories%rowtype; draft public.category_form_revisions%rowtype;
  reviewed private.form_impact_reviews%rowtype; event_id uuid;
begin
  select display_name into actor_name from public.app_members where user_id=actor
    and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','expected_draft_version',
    'expected_published_revision_id','review_token']);
  category_id:=private.inventory_uuid(p_payload,'category_id');
  expected:=private.configuration_version(p_payload,'expected_draft_version');
  expected_published:=private.inventory_uuid(p_payload,'expected_published_revision_id',false);
  review_token:=private.inventory_uuid(p_payload,'review_token');
  normalized:=jsonb_build_object('category_id',category_id,'expected_draft_version',expected::text,
    'expected_published_revision_id',expected_published,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'metadata_publish',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  select * into category_row from public.categories where id=category_id for update;
  if not found or not category_row.active or category_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into draft from public.category_form_revisions r
    where r.category_id=(p_payload->>'category_id')::uuid and r.status='draft' for update;
  if not found or draft.draft_version<>expected or
    category_row.published_form_revision_id is distinct from expected_published then
    raise exception using errcode='P1002',message='stale_form'; end if;
  select * into reviewed from private.form_impact_reviews where token=review_token and actor_id=actor for update;
  if not found or reviewed.expires_at<=clock_timestamp() or reviewed.category_id<>category_id
    or reviewed.draft_id<>draft.id or reviewed.draft_version<>draft.draft_version
    or reviewed.published_id is distinct from category_row.published_form_revision_id
    or reviewed.reference_fingerprint<>private.metadata_reference_fingerprint(category_id) then
    raise exception using errcode='P1017',message='stale_form_review'; end if;
  perform private.metadata_compile_form(draft.id,category_id,draft.draft_definition);
  update public.category_form_revisions set status='published',published_at=now(),published_by=actor where id=draft.id;
  update public.categories set published_form_revision_id=draft.id,version=version+1 where id=category_id;
  insert into public.form_publication_events(actor_id,actor_name,category_id,revision_id,
    previous_revision_id,affected_quantity,affected_assets)
    values(actor,actor_name,category_id,draft.id,expected_published,
      reviewed.affected_quantity,reviewed.affected_assets) returning id into event_id;
  replay:=jsonb_build_object('entity_id',draft.id,'version',draft.revision_number::text,
    'published_revision_id',draft.id,'event_id',event_id,'changed',true);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;

create function private.metadata_needs(rev uuid, entity_kind text, values_json jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare cfg public.form_revision_fields%rowtype; entry jsonb;
begin
  for cfg in select * from public.form_revision_fields where revision_id=rev and entity_kind=any(applies_to) loop
    entry:=values_json->(cfg.field_id::text);
    if entry is null then
      if cfg.required then return true; end if;
    elsif jsonb_typeof(entry)<>'object' or not(entry ? 'value') or
      not private.metadata_value_valid(rev,cfg.field_id,entry->'value') then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create function private.metadata_apply_patch(rev uuid, entity_kind text, prior jsonb, patch jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=coalesce(prior,'{}'::jsonb); field_key text; field_uuid uuid;
  cfg public.form_revision_fields%rowtype; value jsonb;
begin
  if jsonb_typeof(patch) is distinct from 'object' then
    raise exception using errcode='P1012',message='invalid_custom_patch'; end if;
  if exists(select 1 from jsonb_object_keys(patch) k where k not in ('set','unset')) or
    jsonb_typeof(coalesce(patch->'set','{}'::jsonb))<>'object' or
    jsonb_typeof(coalesce(patch->'unset','[]'::jsonb))<>'array' then
    raise exception using errcode='P1012',message='invalid_custom_patch'; end if;
  for field_key in select jsonb_object_keys(coalesce(patch->'set','{}'::jsonb)) loop
    if field_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception using errcode='P1012',message='invalid_field_id'; end if;
    field_uuid:=field_key::uuid;
    if field_key<>field_uuid::text then raise exception using errcode='P1012',message='noncanonical_field_id'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(patch->'unset','[]'::jsonb)) x
      where jsonb_typeof(x)='string' and x#>>'{}'=field_key) then
      raise exception using errcode='P1012',message='patch_overlap'; end if;
    select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field_uuid
      and entity_kind=any(applies_to);
    if not found then raise exception using errcode='P1021',message='field_not_applicable'; end if;
    value:=patch->'set'->field_key;
    if result->field_key->'value' is distinct from value then
      if not private.metadata_value_valid(rev,field_uuid,value) then
        raise exception using errcode='P1021',message='invalid_custom_value'; end if;
      value:=private.metadata_canonical_value(rev,field_uuid,value);
      result:=jsonb_set(result,array[field_key],jsonb_build_object('value',value,'validated_revision_id',rev));
    end if;
  end loop;
  for value in select x from jsonb_array_elements(coalesce(patch->'unset','[]'::jsonb)) x loop
    if jsonb_typeof(value)<>'string' or (value#>>'{}') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception using errcode='P1012',message='invalid_unset_field'; end if;
    field_key:=value#>>'{}'; field_uuid:=field_key::uuid;
    if field_key<>field_uuid::text then raise exception using errcode='P1012',message='noncanonical_field_id'; end if;
    select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field_uuid
      and entity_kind=any(applies_to);
    if not found then
      raise exception using errcode='P1021',message='field_not_applicable'; end if;
    if cfg.required then raise exception using errcode='P1021',message='required_field_cannot_unset'; end if;
    result:=result-field_key;
  end loop;
  if octet_length(result::text)>262144 then
    raise exception using errcode='P1022',message='custom_values_too_large'; end if;
  return result;
end;
$$;

-- Legacy creation and category changes cannot bypass a newly published
-- required form. Ordinary same-category stock/movement/restore paths remain
-- possible even when historical metadata now needs attention.
create function private.metadata_legacy_guard() returns trigger
language plpgsql set search_path='' as $$
declare rev uuid; kind text;
begin
  if tg_op='UPDATE' and new.category_id=old.category_id then return new; end if;
  select published_form_revision_id into rev from public.categories where id=new.category_id;
  kind:=case when tg_table_name='quantity_items' then 'quantity' else 'asset' end;
  if tg_op='UPDATE' then
    if old.custom_values<>'{}'::jsonb and
      coalesce(current_setting('app.metadata_reassignment_reviewed',true),'')<>'on' then
      raise exception using errcode='P1023',message='legacy_metadata_requires_client_upgrade'; end if;
  end if;
  if private.metadata_needs(rev,kind,new.custom_values) and
    coalesce(current_setting('app.metadata_reassignment_reviewed',true),'')<>'on' then
    raise exception using errcode='P1023',message='published_metadata_requires_client_upgrade'; end if;
  new.validated_form_revision_id:=rev;
  new.needs_metadata:=private.metadata_needs(rev,kind,new.custom_values);
  return new;
end;
$$;
create trigger quantity_metadata_legacy_guard before insert or update of category_id on public.quantity_items
  for each row execute function private.metadata_legacy_guard();
create trigger asset_metadata_legacy_guard before insert or update of category_id on public.serialized_assets
  for each row execute function private.metadata_legacy_guard();

create function private.metadata_mutate_v2(p_request_id uuid,p_payload jsonb,p_kind text,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  category_uuid uuid; expected_rev uuid; current_rev uuid; record_id uuid; expected_version integer;
  name_value text; description_value text; manufacturer_value text; model_value text;
  tag_value text; serial_value text; threshold_value integer; location_uuid uuid;
  initial_quantity integer; custom_patch jsonb; new_custom jsonb; old_custom jsonb;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  version_value integer; event_id uuid:=gen_random_uuid(); category_name text;
  previous_category_name text; old_metadata jsonb; new_metadata jsonb; needs boolean;
  category_changed boolean:=false;
  operation text:=p_kind||'_'||p_action||'_v2';
begin
  if p_kind not in ('quantity','asset') or p_action not in ('create','update') then
    raise exception using errcode='P1012',message='invalid_operation'; end if;
  select display_name into actor_name from public.app_members where user_id=actor and active and role='staff' for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_kind='quantity' and p_action='create' then
    perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
      'reorder_threshold','initial_location_id','initial_quantity','expected_published_revision_id','custom_patch']);
  elsif p_kind='quantity' then
    perform private.inventory_payload(p_payload,array['item_id','expected_version','name','description','category_id',
      'manufacturer','model','reorder_threshold','expected_published_revision_id','custom_patch',
      'acknowledge_legacy_values']);
  elsif p_action='create' then
    perform private.inventory_payload(p_payload,array['name','description','category_id','manufacturer','model',
      'asset_tag','serial_number','location_id','expected_published_revision_id','custom_patch']);
  else
    perform private.inventory_payload(p_payload,array['asset_id','expected_version','name','description','category_id',
      'manufacturer','model','asset_tag','serial_number','expected_published_revision_id','custom_patch',
      'acknowledge_legacy_values']);
  end if;
  name_value:=private.inventory_text(p_payload,'name',200,true);
  description_value:=private.inventory_text(p_payload,'description',4000);
  category_uuid:=private.inventory_uuid(p_payload,'category_id');
  expected_rev:=private.inventory_uuid(p_payload,'expected_published_revision_id');
  manufacturer_value:=private.inventory_text(p_payload,'manufacturer',200);
  model_value:=private.inventory_text(p_payload,'model',200);
  custom_patch:=coalesce(p_payload->'custom_patch','{}'::jsonb);
  if p_payload ? 'acknowledge_legacy_values' and
    jsonb_typeof(p_payload->'acknowledge_legacy_values') is distinct from 'boolean' then
    raise exception using errcode='P1012',message='invalid_legacy_acknowledgement'; end if;
  if p_kind='quantity' then
    if p_payload ? 'reorder_threshold' then threshold_value:=private.inventory_threshold(p_payload); end if;
    if p_action='create' then
      location_uuid:=private.inventory_uuid(p_payload,'initial_location_id',false);
      initial_quantity:=private.inventory_integer(p_payload,'initial_quantity',0,0);
      if initial_quantity>0 and location_uuid is null then raise exception using errcode='P1012',message='invalid_input'; end if;
    else record_id:=private.inventory_uuid(p_payload,'item_id');
      expected_version:=private.inventory_integer(p_payload,'expected_version',1); end if;
  else
    tag_value:=lower(private.inventory_text(p_payload,'asset_tag',100));
    serial_value:=private.inventory_text(p_payload,'serial_number',200);
    if p_action='create' then location_uuid:=private.inventory_uuid(p_payload,'location_id');
    else record_id:=private.inventory_uuid(p_payload,'asset_id');
      expected_version:=private.inventory_integer(p_payload,'expected_version',1); end if;
  end if;
  normalized:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
    'manufacturer',manufacturer_value,'model',model_value,'expected_published_revision_id',expected_rev,
    'custom_patch',custom_patch);
  if p_kind='quantity' then
    if p_payload ? 'reorder_threshold' then normalized:=normalized||jsonb_build_object('reorder_threshold',threshold_value); end if;
    if p_action='create' then normalized:=normalized||jsonb_build_object('initial_location_id',location_uuid,
      'initial_quantity',initial_quantity);
    else normalized:=normalized||jsonb_build_object('item_id',record_id,'expected_version',expected_version); end if;
  else
    normalized:=normalized||jsonb_build_object('asset_tag',tag_value,'serial_number',serial_value);
    if p_action='create' then normalized:=normalized||jsonb_build_object('location_id',location_uuid);
    else normalized:=normalized||jsonb_build_object('asset_id',record_id,'expected_version',expected_version); end if;
  end if;
  if p_action='update' then
    normalized:=normalized||jsonb_build_object('acknowledge_legacy_values',
      coalesce((p_payload->>'acknowledge_legacy_values')::boolean,false));
  end if;
  replay:=private.inventory_receipt(actor,p_request_id,operation,normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(false);
  select published_form_revision_id,name into current_rev,category_name from public.categories
    where id=category_uuid and active and removed_at is null for share;
  if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
  if current_rev is distinct from expected_rev then
    raise exception using errcode='P1024',message='stale_published_form'; end if;
  if p_action='update' then
    if p_kind='quantity' then
      select * into item from public.quantity_items where id=record_id for update;
      if not found then raise exception using errcode='P1010',message='not_found'; end if;
      if item.version<>expected_version then raise exception using errcode='P1002',message='stale_version'; end if;
      if item.archived then raise exception using errcode='P1008',message='invalid_transition'; end if;
      old_custom:=item.custom_values;
      category_changed:=item.category_id<>category_uuid;
      if not(p_payload ? 'reorder_threshold') then threshold_value:=item.reorder_threshold; end if;
      old_metadata:=jsonb_build_object('name',item.name,'description',item.description,'category_id',item.category_id,
        'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold,
        'custom_values',item.custom_values,'form_revision_id',item.validated_form_revision_id);
      select name into previous_category_name from public.categories where id=item.category_id;
    else
      select * into asset from public.serialized_assets where id=record_id for update;
      if not found then raise exception using errcode='P1010',message='not_found'; end if;
      if asset.version<>expected_version then raise exception using errcode='P1002',message='stale_version'; end if;
      old_custom:=asset.custom_values;
      category_changed:=asset.category_id<>category_uuid;
      old_metadata:=jsonb_build_object('name',asset.name,'description',asset.description,'category_id',asset.category_id,
        'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,
        'serial_number',asset.serial_number,'custom_values',asset.custom_values,
        'form_revision_id',asset.validated_form_revision_id);
      select name into previous_category_name from public.categories where id=asset.category_id;
    end if;
    old_metadata:=old_metadata||jsonb_build_object('category_name',previous_category_name);
  end if;
  new_custom:=private.metadata_apply_patch(current_rev,p_kind,coalesce(old_custom,'{}'::jsonb),custom_patch);
  needs:=private.metadata_needs(current_rev,p_kind,new_custom);
  if needs and (p_action='create' or (p_kind='quantity' and item.category_id<>category_uuid)
    or (p_kind='asset' and asset.category_id<>category_uuid)) then
    raise exception using errcode='P1023',message='required_published_metadata_missing'; end if;
  if category_changed and old_custom<>'{}'::jsonb then
    if p_payload->'acknowledge_legacy_values' is distinct from 'true'::jsonb then
      raise exception using errcode='P1026',message='legacy_metadata_acknowledgement_required'; end if;
    perform set_config('app.metadata_reassignment_reviewed','on',true);
  end if;
  if p_kind='quantity' then
    if p_action='create' then
      if location_uuid is not null then perform private.inventory_destination(location_uuid); end if;
      insert into public.quantity_items(name,description,category_id,manufacturer,model,reorder_threshold,
        custom_values,validated_form_revision_id,needs_metadata)
        values(name_value,description_value,category_uuid,manufacturer_value,model_value,threshold_value,
          new_custom,current_rev,needs) returning id,version into record_id,version_value;
      if initial_quantity>0 then
        insert into public.stock_balances values(record_id,location_uuid,initial_quantity);
      end if;
    else
      if item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      update public.quantity_items set name=name_value,description=description_value,category_id=category_uuid,
        manufacturer=manufacturer_value,model=model_value,reorder_threshold=threshold_value,
        custom_values=new_custom,validated_form_revision_id=current_rev,needs_metadata=needs,
        version=item.version+1,updated_at=now() where id=record_id returning version into version_value;
    end if;
    new_metadata:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
      'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
      'reorder_threshold',threshold_value,'custom_values',new_custom,'form_revision_id',current_rev);
    insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,before_metadata,after_metadata,version)
      values(event_id,record_id,case when p_action='create' then 'created' else 'metadata_updated' end,
        actor,actor_name,old_metadata,new_metadata,version_value);
    if p_action='create' and initial_quantity>0 then
      insert into public.quantity_event_lines values(event_id,location_uuid,initial_quantity,0,initial_quantity);
    end if;
  else
    if p_action='create' then
      perform private.inventory_destination(location_uuid);
      insert into public.serialized_assets(name,description,category_id,manufacturer,model,asset_tag,
        serial_number,location_id,custom_values,validated_form_revision_id,needs_metadata)
        values(name_value,description_value,category_uuid,manufacturer_value,model_value,tag_value,
          serial_value,location_uuid,new_custom,current_rev,needs) returning id,version into record_id,version_value;
    else
      if asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      update public.serialized_assets set name=name_value,description=description_value,category_id=category_uuid,
        manufacturer=manufacturer_value,model=model_value,asset_tag=tag_value,serial_number=serial_value,
        custom_values=new_custom,validated_form_revision_id=current_rev,needs_metadata=needs,
        version=asset.version+1,updated_at=now() where id=record_id returning version into version_value;
    end if;
    new_metadata:=jsonb_build_object('name',name_value,'description',description_value,'category_id',category_uuid,
      'category_name',category_name,'manufacturer',manufacturer_value,'model',model_value,
      'asset_tag',tag_value,'serial_number',serial_value,'custom_values',new_custom,'form_revision_id',current_rev);
    insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,from_location_id,to_location_id,
      before_metadata,after_metadata,version)
      values(event_id,record_id,case when p_action='create' then 'created' else 'metadata_updated' end,
        actor,actor_name,null,case when p_action='create' then location_uuid end,
        old_metadata,new_metadata,version_value);
  end if;
  replay:=jsonb_build_object('entity_id',record_id,'version',version_value,'event_id',event_id,
    'changed',true,'published_revision_id',current_rev,'needs_metadata',needs);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
exception when unique_violation then raise exception using errcode='P1007',message='identifier_conflict';
end;
$$;
create function public.quantity_create_v2(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
begin
  perform 1 from public.app_members where user_id=auth.uid() and active and role='staff' for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  return private.metadata_mutate_v2(p_request_id,p_payload,'quantity','create');
end;
$$;
create function public.quantity_update_v2(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
begin
  perform 1 from public.app_members where user_id=auth.uid() and active and role='staff' for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  return private.metadata_mutate_v2(p_request_id,p_payload,'quantity','update');
end;
$$;
create function public.asset_create_v2(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
begin
  perform 1 from public.app_members where user_id=auth.uid() and active and role='staff' for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  return private.metadata_mutate_v2(p_request_id,p_payload,'asset','create');
end;
$$;
create function public.asset_update_v2(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
begin
  perform 1 from public.app_members where user_id=auth.uid() and active and role='staff' for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  return private.metadata_mutate_v2(p_request_id,p_payload,'asset','update');
end;
$$;

create function public.metadata_form_get(p_category_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); maintainer boolean; current_row public.category_form_revisions%rowtype;
  draft_row public.category_form_revisions%rowtype; current_id uuid;
begin
  select role='staff' and can_manage_configuration into maintainer from public.app_members
    where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  select published_form_revision_id into current_id from public.categories where id=p_category_id;
  if not found then raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into current_row from public.category_form_revisions where id=current_id;
  if maintainer then
    select * into draft_row from public.category_form_revisions where category_id=p_category_id and status='draft';
  end if;
  return jsonb_build_object('category_id',p_category_id,'published_revision_id',current_id,
    'published_number',current_row.revision_number::text,'published_definition',current_row.draft_definition,
    'draft_id',draft_row.id,'draft_version',draft_row.draft_version::text,
    'draft_definition',draft_row.draft_definition);
end;
$$;

create function private.metadata_option_path(rev uuid, field uuid, selected uuid) returns text[]
language sql stable set search_path='' as $$
  with recursive path as (
    select option_id,parent_option_id,label,1 depth from public.form_revision_options
      where revision_id=rev and field_id=field and option_id=selected
    union all
    select parent.option_id,parent.parent_option_id,parent.label,path.depth+1
      from path join public.form_revision_options parent on parent.revision_id=rev
        and parent.field_id=field and parent.option_id=path.parent_option_id
      where path.depth<64
  )
  select array_agg(label order by depth desc) from path;
$$;
create function public.metadata_describe_values(p_values jsonb,p_current_category uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); field_key text; entry jsonb; rev uuid; field_uuid uuid;
  cfg public.form_revision_fields%rowtype; kind text; option_id uuid; paths jsonb; choice jsonb;
  result jsonb:='{}'::jsonb; choice_path text[]; path_bytes integer; current_form uuid;
begin
  perform 1 from public.app_members where user_id=actor and active;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if jsonb_typeof(p_values)<>'object' or octet_length(p_values::text)>262144 then
    raise exception using errcode='P1012',message='invalid_custom_values'; end if;
  select published_form_revision_id into current_form from public.categories
    where id=p_current_category;
  for field_key,entry in select key,value from jsonb_each(p_values) loop
    if jsonb_typeof(entry) is distinct from 'object' then
      raise exception using errcode='P1012',message='invalid_custom_values'; end if;
    if field_key !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or not (entry ?& array['value','validated_revision_id'])
      or (select count(*) from jsonb_object_keys(entry))<>2
      or jsonb_typeof(entry->'validated_revision_id') is distinct from 'string'
      or not coalesce((entry->>'validated_revision_id') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',false) then
      raise exception using errcode='P1012',message='invalid_custom_values'; end if;
    field_uuid:=field_key::uuid; rev:=(entry->>'validated_revision_id')::uuid;
    if field_key<>field_uuid::text or not exists(
      select 1 from public.category_form_revisions where id=rev and status='published'
    ) then raise exception using errcode='P1012',message='invalid_custom_values'; end if;
    select * into cfg from public.form_revision_fields where revision_id=rev and field_id=field_uuid;
    if not found or not private.metadata_value_valid(rev,field_uuid,entry->'value') then
      raise exception using errcode='P1012',message='invalid_custom_values'; end if;
    select field_type into kind from public.metadata_fields where id=field_uuid;
    paths:='[]'::jsonb;
    path_bytes:=0;
    if kind in ('single_select','hierarchical_select') and jsonb_typeof(entry->'value')='string' then
      option_id:=(entry->>'value')::uuid;
      choice_path:=private.metadata_option_path(rev,field_uuid,option_id);
      path_bytes:=octet_length(to_jsonb(choice_path)::text);
      if path_bytes>2096640 then raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
      paths:=jsonb_build_array(choice_path);
    elsif kind='multi_select' and jsonb_typeof(entry->'value')='array' then
      if jsonb_array_length(entry->'value')>1000 then
        raise exception using errcode='P1022',message='selection_resource_limit'; end if;
      if (select count(distinct x::text) from jsonb_array_elements(entry->'value') x)<>
         jsonb_array_length(entry->'value') then
        raise exception using errcode='P1012',message='duplicate_selected_option'; end if;
      for choice in select x from jsonb_array_elements(entry->'value') x loop
        option_id:=(choice#>>'{}')::uuid;
        choice_path:=private.metadata_option_path(rev,field_uuid,option_id);
        path_bytes:=path_bytes+octet_length(to_jsonb(choice_path)::text)+1;
        if path_bytes>2096640 then raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
        paths:=paths||jsonb_build_array(choice_path);
      end loop;
    end if;
    result:=result||jsonb_build_object(field_key,jsonb_build_object('value',entry->'value',
      'validated_revision_id',rev,'label',cfg.label,'field_type',kind,'option_paths',paths,
      'legacy',rev is distinct from current_form or not exists(
        select 1 from public.form_revision_fields current_field
          where current_field.revision_id=current_form and current_field.field_id=field_uuid)));
    if octet_length(result::text)>2096640 then
      raise exception using errcode='P1025',message='metadata_description_too_large'; end if;
  end loop;
  return result;
end;
$$;

revoke all on function private.metadata_immutable(),private.metadata_identity_immutable(),
  private.metadata_seed_form(),private.metadata_seed_category(),private.metadata_category_pointer_valid(),
  private.metadata_currency_code_valid(text),private.metadata_value_valid(uuid,uuid,jsonb),
  private.metadata_canonical_value(uuid,uuid,jsonb),
  private.metadata_date_bound_valid(text,text),private.metadata_validate_rules(text,jsonb),
  private.metadata_compile_form(uuid,uuid,jsonb),private.metadata_reference_fingerprint(uuid),
  private.metadata_needs(uuid,text,jsonb),private.metadata_apply_patch(uuid,text,jsonb,jsonb),
  private.metadata_legacy_guard(),private.metadata_mutate_v2(uuid,jsonb,text,text),
  private.metadata_option_path(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.metadata_draft_save(uuid,jsonb),public.metadata_draft_discard(uuid,jsonb),
  public.metadata_publish_review(uuid),public.metadata_publish(uuid,jsonb),public.metadata_form_get(uuid),
  public.metadata_describe_values(jsonb,uuid),public.quantity_create_v2(uuid,jsonb),public.quantity_update_v2(uuid,jsonb),
  public.asset_create_v2(uuid,jsonb),public.asset_update_v2(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.metadata_draft_save(uuid,jsonb),public.metadata_draft_discard(uuid,jsonb),
  public.metadata_publish_review(uuid),public.metadata_publish(uuid,jsonb),public.metadata_form_get(uuid),
  public.metadata_describe_values(jsonb,uuid),public.quantity_create_v2(uuid,jsonb),public.quantity_update_v2(uuid,jsonb),
  public.asset_create_v2(uuid,jsonb),public.asset_update_v2(uuid,jsonb) to authenticated;

-- A cursor checks each row and nested holding before appending to the result.
-- The returned JSON, including its envelope, is at most 2 MiB in UTF-8.
create function public.inventory_export_snapshot(
  p_query text,p_type text,p_status text,p_category_id uuid,p_location_code text,
  p_low_stock boolean,p_export_type text,p_include_custom boolean
) returns jsonb language plpgsql stable security invoker set search_path='' set statement_timeout='5s' as $$
declare r record; holding record; kv record; one_row jsonb; custom jsonb; described jsonb;
  custom_out jsonb; current_form uuid;
  rows_json jsonb[]:=array[]::jsonb[]; used_bytes integer:=128; row_bytes integer;
  count_rows integer:=0; holdings text; response jsonb; exported_at timestamptz:=statement_timestamp();
begin
  if p_export_type not in ('inventory','low_stock') or p_export_type is null then
    raise exception using errcode='P1012',message='invalid_export_type'; end if;
  if p_type is null or p_type not in ('all','quantity','asset')
    or p_status is null or p_status not in ('all','active','historical')
    or length(coalesce(p_query,''))>200 or length(coalesce(p_location_code,''))>100 then
    raise exception using errcode='P1012',message='invalid_export_filter'; end if;
  if p_export_type='inventory' then
    for r in
      select * from public.inventory_search_rows x
      where (p_type='all' or x.kind=p_type)
        and (p_status='all' or (p_status='active' and x.status='active')
          or (p_status='historical' and x.status<>'active'))
        and (p_category_id is null or x.category_id=p_category_id)
        and (p_location_code is null or p_location_code=any(x.ancestor_codes))
        and (not coalesce(p_low_stock,false) or x.stock_state in ('needs_restocking','out_of_stock'))
        and strpos(lower(concat_ws(' ',x.name,x.description,x.manufacturer,x.model,x.category_name,
          x.location_code,x.location_name,x.breadcrumb,x.asset_tag,x.serial_number)),lower(coalesce(p_query,'')))>0
      order by lower(x.name),x.kind,x.entity_id,coalesce(x.location_code,'') limit 10001
    loop
      count_rows:=count_rows+1;
      if count_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
      one_row:=to_jsonb(r)-'recorded_total'-'reorder_threshold'-'stock_state';
      if p_include_custom then
        if r.kind='quantity' then
          select custom_values into custom from public.quantity_items where id=r.entity_id;
        else select custom_values into custom from public.serialized_assets where id=r.entity_id; end if;
        described:=public.metadata_describe_values(custom,r.category_id);
        select published_form_revision_id into current_form from public.categories where id=r.category_id;
        custom_out:='{}'::jsonb;
        for kv in select key,value from jsonb_each(described) loop
          custom_out:=custom_out||jsonb_build_object(kv.key,kv.value||jsonb_build_object(
            'category_id',r.category_id,'current_published_revision_id',current_form));
          if octet_length(custom_out::text)>2096640 then
            raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
        end loop;
        one_row:=one_row||jsonb_build_object('custom_fields',custom_out);
      end if;
      row_bytes:=octet_length(one_row::text)+1;
      if row_bytes>2096640 then raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
      used_bytes:=used_bytes+row_bytes;
      if used_bytes>2096640 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
      rows_json:=array_append(rows_json,one_row);
    end loop;
  else
    for r in
      with matches as (
        select distinct x.entity_id from public.inventory_search_rows x
        where x.kind='quantity' and x.status='active'
          and x.stock_state in ('needs_restocking','out_of_stock')
          and (p_type='all' or p_type='quantity') and (p_status='all' or p_status='active')
          and (p_category_id is null or x.category_id=p_category_id)
          and (p_location_code is null or p_location_code=any(x.ancestor_codes))
          and strpos(lower(concat_ws(' ',x.name,x.description,x.manufacturer,x.model,x.category_name,
            x.location_code,x.location_name,x.breadcrumb,x.asset_tag,x.serial_number)),lower(coalesce(p_query,'')))>0
        limit 10001
      )
      select chosen.* from (
        select distinct on (x.entity_id) x.* from matches m
          join public.inventory_search_rows x on x.entity_id=m.entity_id and x.kind='quantity'
        order by x.entity_id,x.location_code
      ) chosen order by lower(chosen.name),chosen.entity_id
    loop
      count_rows:=count_rows+1;
      if count_rows>10000 then raise exception using errcode='P1013',message='export_row_limit'; end if;
      holdings:='';
      for holding in select x.location_code,x.breadcrumb,x.quantity from public.inventory_search_rows x
        where x.kind='quantity' and x.entity_id=r.entity_id and x.location_code is not null
        order by x.location_code loop
        if holdings<>'' then holdings:=holdings||'; '; end if;
        holdings:=holdings||holding.breadcrumb||' ['||holding.location_code||']: '||holding.quantity::text;
        if octet_length(holdings)>2096640 then
          raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
      end loop;
      one_row:=jsonb_build_object('entity_id',r.entity_id,'kind','quantity','name',r.name,
        'description',r.description,'manufacturer',r.manufacturer,'model',r.model,
        'category_id',r.category_id,'category_name',r.category_name,'status',r.status,
        'reorder_threshold',r.reorder_threshold,'recorded_total',r.recorded_total::text,
        'stock_state',r.stock_state,'holding_context',holdings);
      if p_include_custom then
        select custom_values into custom from public.quantity_items where id=r.entity_id;
        described:=public.metadata_describe_values(custom,r.category_id);
        select published_form_revision_id into current_form from public.categories where id=r.category_id;
        custom_out:='{}'::jsonb;
        for kv in select key,value from jsonb_each(described) loop
          custom_out:=custom_out||jsonb_build_object(kv.key,kv.value||jsonb_build_object(
            'category_id',r.category_id,'current_published_revision_id',current_form));
          if octet_length(custom_out::text)>2096640 then
            raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
        end loop;
        one_row:=one_row||jsonb_build_object('custom_fields',custom_out);
      end if;
      row_bytes:=octet_length(one_row::text)+1;
      if row_bytes>2096640 then raise exception using errcode='P1025',message='single_export_record_too_large'; end if;
      used_bytes:=used_bytes+row_bytes;
      if used_bytes>2096640 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
      rows_json:=array_append(rows_json,one_row);
    end loop;
  end if;
  response:=jsonb_build_object('rows',to_jsonb(rows_json),'total',count_rows::text,'exported_at',exported_at,
    'custom_fields_included',coalesce(p_include_custom,false));
  if octet_length(response::text)>2097152 then raise exception using errcode='P1025',message='export_byte_limit'; end if;
  return response;
end;
$$;
create or replace function public.inventory_export_snapshot(
  p_query text default '',p_type text default 'all',p_status text default 'active',
  p_category_id uuid default null,p_location_code text default null,
  p_low_stock boolean default false,p_export_type text default 'inventory'
) returns jsonb language sql stable security invoker set search_path='' set statement_timeout='5s' as $$
  select jsonb_set(result,'{total}',to_jsonb((result->>'total')::integer))
  from (select public.inventory_export_snapshot(p_query,p_type,p_status,p_category_id,
    p_location_code,p_low_stock,p_export_type,false) result) bounded;
$$;
revoke all on function public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.inventory_export_snapshot(text,text,text,uuid,text,boolean,text,boolean)
  to authenticated;

-- Category removal now includes authored form and retained value impact.
alter table private.category_impact_reviews
  add column authored_revision_count bigint not null default 0 check(authored_revision_count>=0),
  add column retained_value_count bigint not null default 0 check(retained_value_count>=0),
  add column authored_revision_fingerprint text not null default md5(''),
  add column retained_value_fingerprint text not null default md5(''),
  add column quantity_needs_metadata_count bigint not null default 0 check(quantity_needs_metadata_count>=0),
  add column asset_needs_metadata_count bigint not null default 0 check(asset_needs_metadata_count>=0);

create function private.metadata_category_references(category uuid) returns jsonb
language sql stable set search_path='' as $$
  with referenced as materialized (
    select * from (
      select 'quantity'::text kind,q.id,q.version,q.custom_values
        from public.quantity_items q
        where q.custom_values<>'{}'::jsonb and exists(
          select 1 from jsonb_object_keys(q.custom_values) as entry(field_id_text)
            join public.metadata_fields f on f.id::text=entry.field_id_text
            where f.category_id=category
        )
      union all
      select 'asset'::text kind,a.id,a.version,a.custom_values
        from public.serialized_assets a
        where a.custom_values<>'{}'::jsonb and exists(
          select 1 from jsonb_object_keys(a.custom_values) as entry(field_id_text)
            join public.metadata_fields f on f.id::text=entry.field_id_text
            where f.category_id=category
        )
    ) all_references limit 10001
  )
  select jsonb_build_object(
    'authored_revision_count',(
      select count(*) from public.category_form_revisions where category_id=category
    ),
    'retained_value_count',(select count(*) from referenced),
    'authored_revision_fingerprint',(
      select md5(coalesce(string_agg(id::text||':'||draft_version::text||':'||status||':'||
        md5(coalesce(draft_definition::text,'')),',' order by id),''))
      from public.category_form_revisions where category_id=category
    ),
    'retained_value_fingerprint',(
      select md5(coalesce(string_agg(kind||':'||id::text||':'||version::text||':'||
        md5(custom_values::text),',' order by kind,id),'')) from referenced
    )
  );
$$;
revoke all on function private.metadata_category_references(uuid)
  from public,anon,authenticated,service_role;

create or replace function public.category_removal_review(p_category_id uuid,p_replacement_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); source_row public.categories%rowtype; target_row public.categories%rowtype;
  refs jsonb; historical_refs jsonb; metadata_refs jsonb; token_id uuid;
  quantity_count integer; asset_count integer; q_needs bigint:=0; a_needs bigint:=0;
begin
  perform 1 from public.app_members where user_id=actor and active and role='staff'
    and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  if p_category_id is null or p_category_id=p_replacement_id then
    raise exception using errcode='P1012',message='invalid_input'; end if;
  perform private.configuration_catalog_lock(false);
  select * into source_row from public.categories where id=p_category_id for share;
  if not found or not source_row.active or source_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  if p_replacement_id is not null then
    select * into target_row from public.categories where id=p_replacement_id for share;
    if not found or not target_row.active or target_row.removed_at is not null then
      raise exception using errcode='P1011',message='invalid_category'; end if;
  end if;
  refs:=private.category_reference_set(p_category_id);
  if jsonb_array_length(refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  select count(*) filter(where x->>'kind'='quantity'),count(*) filter(where x->>'kind'='asset')
    into quantity_count,asset_count from jsonb_array_elements(refs) x;
  historical_refs:=private.category_historical_reference_counts(p_category_id);
  metadata_refs:=private.metadata_category_references(p_category_id);
  if (metadata_refs->>'retained_value_count')::bigint>10000 then
    raise exception using errcode='P1015',message='impact_too_large'; end if;
  if p_replacement_id is not null then
    select count(*) into q_needs from public.quantity_items q where q.category_id=p_category_id
      and private.metadata_needs(target_row.published_form_revision_id,'quantity',q.custom_values);
    select count(*) into a_needs from public.serialized_assets a where a.category_id=p_category_id
      and private.metadata_needs(target_row.published_form_revision_id,'asset',a.custom_values);
  end if;
  insert into private.category_impact_reviews(actor_id,source_id,target_id,source_version,target_version,
    reference_set,historical_quantity_count,historical_asset_count,authored_revision_count,retained_value_count,
    authored_revision_fingerprint,retained_value_fingerprint,
    quantity_needs_metadata_count,asset_needs_metadata_count)
    values(actor,p_category_id,p_replacement_id,source_row.version,target_row.version,refs,
      (historical_refs->>'quantity_count')::bigint,(historical_refs->>'asset_count')::bigint,
      (metadata_refs->>'authored_revision_count')::bigint,
      (metadata_refs->>'retained_value_count')::bigint,
      metadata_refs->>'authored_revision_fingerprint',
      metadata_refs->>'retained_value_fingerprint',q_needs,a_needs) returning token into token_id;
  return jsonb_build_object('token',token_id,'source_id',p_category_id,'source_name',source_row.name,
    'source_version',source_row.version::text,'target_id',p_replacement_id,
    'target_name',target_row.name,'target_version',target_row.version::text,
    'quantity_count',quantity_count::text,'asset_count',asset_count::text,
    'historical_quantity_count',historical_refs->>'quantity_count',
    'historical_asset_count',historical_refs->>'asset_count',
    'authored_revision_count',metadata_refs->>'authored_revision_count',
    'retained_value_count',metadata_refs->>'retained_value_count',
    'quantity_needs_metadata_count',q_needs::text,
    'asset_needs_metadata_count',a_needs::text,
    'will_tombstone',quantity_count+asset_count>0 or
      (historical_refs->>'quantity_count')::bigint+(historical_refs->>'asset_count')::bigint>0 or
      (metadata_refs->>'authored_revision_count')::bigint+(metadata_refs->>'retained_value_count')::bigint>0,
    'expires_at',clock_timestamp()+interval '15 minutes');
end;
$$;


create or replace function public.category_remove(p_request_id uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid:=auth.uid(); actor_name text; normalized jsonb; replay jsonb;
  source_id uuid; target_id uuid; review_token uuid; reviewed private.category_impact_reviews%rowtype;
  source_row public.categories%rowtype; target_row public.categories%rowtype;
  item public.quantity_items%rowtype; asset public.serialized_assets%rowtype;
  current_refs jsonb; historical_refs jsonb; metadata_refs jsonb;
  q_count integer:=0; a_count integer:=0; q_needs bigint:=0; a_needs bigint:=0;
  historical boolean; tombstoned boolean; event_id uuid;
begin
  select display_name into actor_name from public.app_members
    where user_id=actor and active and role='staff' and can_manage_configuration for share;
  if not found then raise exception using errcode='P1001',message='forbidden'; end if;
  perform private.inventory_payload(p_payload,array['category_id','replacement_id','review_token']);
  source_id:=private.inventory_uuid(p_payload,'category_id');
  target_id:=private.inventory_uuid(p_payload,'replacement_id',false);
  review_token:=private.inventory_uuid(p_payload,'review_token');
  if source_id=target_id then raise exception using errcode='P1012',message='invalid_input'; end if;
  normalized:=jsonb_build_object('category_id',source_id,'replacement_id',target_id,'review_token',review_token);
  replay:=private.inventory_receipt(actor,p_request_id,'category_remove',normalized);
  if replay is not null then return replay; end if;
  perform private.configuration_catalog_lock(true);
  -- Category locks precede inventory locks. The order is stable by UUID.
  if target_id is not null and target_id<source_id then
    select * into target_row from public.categories where id=target_id for update;
    select * into source_row from public.categories where id=source_id for update;
  else
    select * into source_row from public.categories where id=source_id for update;
    if target_id is not null then select * into target_row from public.categories where id=target_id for update; end if;
  end if;
  if source_row.id is null or not source_row.active or source_row.removed_at is not null then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  if target_id is not null and (target_row.id is null or not target_row.active or target_row.removed_at is not null) then
    raise exception using errcode='P1011',message='invalid_category'; end if;
  select * into reviewed from private.category_impact_reviews where token=review_token and actor_id=actor for update;
  if not found or reviewed.expires_at<=clock_timestamp() or reviewed.source_id<>source_id
    or reviewed.target_id is distinct from target_id or reviewed.source_version<>source_row.version
    or reviewed.target_version is distinct from target_row.version then
    raise exception using errcode='P1017',message='stale_review'; end if;
  current_refs:=private.category_reference_set(source_id);
  if jsonb_array_length(current_refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  -- Lock no more than the capped reference set, then verify it again.
  for item in select * from public.quantity_items where category_id=source_id order by id for update loop
    null;
  end loop;
  for asset in select * from public.serialized_assets where category_id=source_id order by id for update loop
    null;
  end loop;
  current_refs:=private.category_reference_set(source_id);
  if current_refs<>reviewed.reference_set then raise exception using errcode='P1017',message='stale_review'; end if;
  historical_refs:=private.category_historical_reference_counts(source_id);
  if (historical_refs->>'quantity_count')::bigint<>reviewed.historical_quantity_count
    or (historical_refs->>'asset_count')::bigint<>reviewed.historical_asset_count then
    raise exception using errcode='P1017',message='stale_review'; end if;
  metadata_refs:=private.metadata_category_references(source_id);
  if (metadata_refs->>'retained_value_count')::bigint>10000 then
    raise exception using errcode='P1015',message='impact_too_large'; end if;
  if (metadata_refs->>'authored_revision_count')::bigint<>reviewed.authored_revision_count
    or (metadata_refs->>'retained_value_count')::bigint<>reviewed.retained_value_count
    or (metadata_refs->>'authored_revision_fingerprint')<>reviewed.authored_revision_fingerprint
    or (metadata_refs->>'retained_value_fingerprint')<>reviewed.retained_value_fingerprint then
    raise exception using errcode='P1017',message='stale_review'; end if;
  if target_id is not null then
    select count(*) into q_needs from public.quantity_items q where q.category_id=source_id
      and private.metadata_needs(target_row.published_form_revision_id,'quantity',q.custom_values);
    select count(*) into a_needs from public.serialized_assets a where a.category_id=source_id
      and private.metadata_needs(target_row.published_form_revision_id,'asset',a.custom_values);
  end if;
  if q_needs<>reviewed.quantity_needs_metadata_count
    or a_needs<>reviewed.asset_needs_metadata_count then
    raise exception using errcode='P1017',message='stale_review'; end if;
  if jsonb_array_length(current_refs)>10000 then raise exception using errcode='P1015',message='impact_too_large'; end if;
  if (jsonb_array_length(current_refs)>0 or reviewed.historical_quantity_count>0
    or reviewed.historical_asset_count>0) and target_id is null then
    raise exception using errcode='P1018',message='replacement_required'; end if;
  if target_id is not null then
    -- This narrowly scoped exception retains source values and flags target gaps.
    -- Only a reviewed category removal may activate it in this transaction.
    perform set_config('app.metadata_reassignment_reviewed','on',true);
    for item in select * from public.quantity_items where category_id=source_id order by id loop
      if item.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      event_id:=gen_random_uuid();
      update public.quantity_items set category_id=target_id,version=item.version+1,updated_at=now() where id=item.id;
      insert into public.quantity_events(id,item_id,kind,actor_id,actor_name,reason,before_metadata,after_metadata,version)
      values(event_id,item.id,'metadata_updated',actor,actor_name,'Category removed: '||source_row.name,
        jsonb_build_object('name',item.name,'description',item.description,'category_id',source_id,'category_name',source_row.name,'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold,'custom_values',item.custom_values,'form_revision_id',item.validated_form_revision_id),
        jsonb_build_object('name',item.name,'description',item.description,'category_id',target_id,'category_name',target_row.name,'manufacturer',item.manufacturer,'model',item.model,'reorder_threshold',item.reorder_threshold,'custom_values',item.custom_values,'form_revision_id',target_row.published_form_revision_id),item.version+1);
      q_count:=q_count+1;
    end loop;
    for asset in select * from public.serialized_assets where category_id=source_id order by id loop
      if asset.version=2147483647 then raise exception using errcode='P1008',message='invalid_transition'; end if;
      event_id:=gen_random_uuid();
      update public.serialized_assets set category_id=target_id,version=asset.version+1,updated_at=now() where id=asset.id;
      insert into public.asset_events(id,asset_id,kind,actor_id,actor_name,reason,from_location_id,to_location_id,before_metadata,after_metadata,version)
      values(event_id,asset.id,'metadata_updated',actor,actor_name,'Category removed: '||source_row.name,
        null,null,
        jsonb_build_object('name',asset.name,'description',asset.description,'category_id',source_id,'category_name',source_row.name,'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,'serial_number',asset.serial_number,'custom_values',asset.custom_values,'form_revision_id',asset.validated_form_revision_id),
        jsonb_build_object('name',asset.name,'description',asset.description,'category_id',target_id,'category_name',target_row.name,'manufacturer',asset.manufacturer,'model',asset.model,'asset_tag',asset.asset_tag,'serial_number',asset.serial_number,'custom_values',asset.custom_values,'form_revision_id',target_row.published_form_revision_id),asset.version+1);
      a_count:=a_count+1;
    end loop;
  end if;
  select exists(
    select 1 from public.quantity_events e where e.before_metadata->>'category_id'=source_id::text or e.after_metadata->>'category_id'=source_id::text
    union all
    select 1 from public.asset_events e where e.before_metadata->>'category_id'=source_id::text or e.after_metadata->>'category_id'=source_id::text
  ) into historical;
  tombstoned:=historical or q_count+a_count>0 or reviewed.authored_revision_count>0
    or reviewed.retained_value_count>0;
  if tombstoned then
    if source_row.version=9223372036854775807 then raise exception using errcode='P1008',message='invalid_transition'; end if;
    update public.categories set active=false,removed_at=now(),version=source_row.version+1 where id=source_id;
  else
    delete from public.categories where id=source_id;
  end if;
  insert into public.configuration_events(actor_id,actor_name,kind,category_id,before_state,after_state,affected_quantity,affected_assets)
    values(actor,actor_name,'category_removed',source_id,
      jsonb_build_object('code',source_row.code,'name',source_row.name,'version',source_row.version::text),
      jsonb_build_object('replacement_id',target_id,'tombstoned',tombstoned,
        'authored_revision_count',reviewed.authored_revision_count::text,
        'retained_value_count',reviewed.retained_value_count::text,
        'quantity_needs_metadata_count',q_needs::text,
        'asset_needs_metadata_count',a_needs::text),q_count,a_count) returning id into event_id;
  replay:=jsonb_build_object('entity_id',source_id,'category_id',source_id,'version',case when tombstoned then (source_row.version+1)::text else null end,
    'event_id',event_id,'changed',true,'quantity_count',q_count::text,'asset_count',a_count::text,
    'historical_quantity_count',reviewed.historical_quantity_count::text,
    'historical_asset_count',reviewed.historical_asset_count::text,
    'authored_revision_count',reviewed.authored_revision_count::text,
    'retained_value_count',reviewed.retained_value_count::text,
    'quantity_needs_metadata_count',q_needs::text,
    'asset_needs_metadata_count',a_needs::text,'tombstoned',tombstoned);
  update private.mutation_requests set result=replay where actor_id=actor and request_id=p_request_id;
  return replay;
end;
$$;


