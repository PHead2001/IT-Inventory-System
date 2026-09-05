-- Application access is explicit. No inventory mutation RPCs are introduced here.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.app_members (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 200),
  role text not null check (role in ('viewer', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 200),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index categories_name_normalized on public.categories (lower(name));
create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$'),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 200),
  parent_id uuid references public.locations(id) on delete restrict,
  kind text not null check (kind in ('room','storage_group','shelf','shelf_section','drawer','rack','container')),
  can_hold_inventory boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_not_self_parent check (parent_id is distinct from id),
  constraint locations_root_shape check ((kind = 'room') = (parent_id is null))
);
create index locations_parent_id on public.locations(parent_id);

create function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger members_timestamp before update on public.app_members
for each row execute function private.set_updated_at();
create trigger categories_timestamp before update on public.categories
for each row execute function private.set_updated_at();
create trigger locations_timestamp before update on public.locations
for each row execute function private.set_updated_at();

create function private.preserve_location_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.code is distinct from old.code then
    raise exception 'Location identity is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger location_identity before update on public.locations
for each row execute function private.preserve_location_identity();

-- A real row update serializes privileged hierarchy changes, including stale
-- REPEATABLE READ snapshots. Application roles cannot access this guard.
create table private.location_hierarchy_guard (
  singleton boolean primary key check (singleton),
  token boolean not null default false
);
insert into private.location_hierarchy_guard(singleton) values (true);
create function private.lock_location_hierarchy() returns trigger
language plpgsql set search_path = '' as $$
begin
  update private.location_hierarchy_guard set token = not token where singleton;
  if not found then raise exception 'Location hierarchy guard missing'; end if;
  return null;
end;
$$;
create trigger locations_serialize before insert or update or delete on public.locations
for each statement execute function private.lock_location_hierarchy();

create function private.validate_location_hierarchy() returns trigger
language plpgsql set search_path = '' as $$
begin
  if exists (
    with recursive ancestors as (
      select id, parent_id, array[id] as visited, false as cycle from public.locations
      union all
      select p.id, p.parent_id, a.visited || p.id, p.id = any(a.visited)
      from ancestors a join public.locations p on p.id = a.parent_id
      where not a.cycle
    )
    select 1 from ancestors where cycle
  ) then raise exception 'Location hierarchy cannot contain cycles' using errcode = '23514'; end if;
  if exists (
    select 1 from public.locations c join public.locations p on p.id = c.parent_id
    where not (
      (c.kind in ('storage_group','rack','container') and p.kind = 'room')
      or (c.kind in ('shelf','drawer') and p.kind = 'storage_group')
      or (c.kind = 'shelf_section' and p.kind = 'shelf')
    )
  ) then raise exception 'Invalid location parent kind' using errcode = '23514'; end if;
  return null;
end;
$$;
create trigger locations_hierarchy after insert or update or delete on public.locations
for each statement execute function private.validate_location_hierarchy();

alter table public.app_members enable row level security;
alter table public.categories enable row level security;
alter table public.locations enable row level security;

create policy members_read_self on public.app_members for select to authenticated
using (user_id = (select auth.uid()) and active);
create policy categories_member_read on public.categories for select to authenticated
using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active));
create policy locations_member_read on public.locations for select to authenticated
using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.active));

revoke all on public.app_members, public.categories, public.locations from public, anon, authenticated;
grant select on public.app_members, public.categories, public.locations to authenticated;
grant all on public.app_members, public.categories, public.locations to service_role;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
-- Supabase administration/fixtures may update location records; triggers use invoker rights.
grant usage on schema private to service_role;
grant select, update on private.location_hierarchy_guard to service_role;
