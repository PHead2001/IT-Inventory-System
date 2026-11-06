import 'server-only';
import { z } from 'zod';
import { spaces } from '@/features/room/spaces';
import { LOCATION_CODE } from '@/features/scan/targets';
import type { requireMember } from '@/lib/auth/session.server';
import { readFileListSummaries } from '@/features/files/list.server';
import {
  peekLocationSchema,
  peekPayloadSchema,
  type PeekTarget,
} from './contracts';

type Context = Awaited<ReturnType<typeof requireMember>>;
const locationColumns =
  'code,name,breadcrumb,active,can_hold_inventory,ancestor_codes';
const locationRow = peekLocationSchema
  .omit({ canHold: true, spaceRootCode: true })
  .extend({
    can_hold_inventory: z.boolean(),
    ancestor_codes: z.array(z.string().max(100).regex(LOCATION_CODE)).min(1),
  });
function data<T>(result: { data: T | null; error: unknown }): T | null {
  if (result.error) throw result.error;
  return result.data;
}
function location(input: unknown) {
  const row = locationRow.parse(input);
  if (
    row.ancestor_codes.at(-1) !== row.code ||
    new Set(row.ancestor_codes).size !== row.ancestor_codes.length
  )
    throw new Error('Current location ancestry unavailable');
  const spaceRootCode =
    [...row.ancestor_codes]
      .reverse()
      .find((code) => spaces.some((space) => space.rootCode === code)) ?? null;
  return {
    code: row.code,
    name: row.name,
    breadcrumb: row.breadcrumb,
    active: row.active,
    canHold: row.can_hold_inventory,
    spaceRootCode,
  };
}
const versionRow = z.object({
  version: z
    .string()
    .regex(/^[1-9]\d*$/)
    .max(40),
});
class ChangedDuringRead extends Error {}
function checkSignal(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Current details deadline expired');
}
function accessDenied(error: unknown) {
  const code =
    typeof error === 'object' && error && 'code' in error ? error.code : null;
  return (
    typeof code === 'string' &&
    ['42501', 'P1001', 'PGRST301', 'PGRST302', 'PGRST303'].includes(code)
  );
}
export async function readPeek(
  context: Context,
  target: PeekTarget,
  signal: AbortSignal,
) {
  // Inventory changes increment the parent version atomically with holdings.
  // A retry repeats every bounded read inside the original route deadline.
  for (let attempt = 0; attempt < 2; attempt++) {
    checkSignal(signal);
    try {
      return await readAttempt(context, target, signal);
    } catch (error) {
      if (!(error instanceof ChangedDuringRead)) throw error;
      if (attempt === 1)
        throw new Error(
          'Current details changed. Open the record or try again.',
        );
    }
  }
  throw new Error('Current details unavailable');
}
async function readAttempt(
  context: Context,
  target: PeekTarget,
  signal: AbortSignal,
) {
  const { supabase } = context;
  const base = {
    target,
    assetTag: null,
    stock: null,
    locations: [],
    moreLocations: false,
    siteName: null,
    photo: null,
  };
  if (target.kind === 'location') {
    const row = data(
      await supabase
        .from('inventory_locations')
        .select(locationColumns)
        .eq('code', target.code)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
    );
    if (!row) return null;
    const ref = location(row);
    return peekPayloadSchema.parse({
      ...base,
      name: ref.name,
      status: ref.active ? 'active' : 'inactive',
      locations: [ref],
    });
  }
  const parent = data(
    await supabase
      .from(target.kind === 'asset' ? 'serialized_assets' : 'quantity_items')
      .select(
        target.kind === 'asset'
          ? 'id,name,status,asset_tag,location_id,site_id,version::text'
          : 'id,name,archived,version::text',
      )
      .eq('id', target.id)
      .limit(1)
      .abortSignal(signal)
      .maybeSingle(),
  );
  if (!parent) return null;
  const before = versionRow.parse(parent).version;
  const finish = async (payload: unknown) => {
    checkSignal(signal);
    const after = data(
      await supabase
        .from(target.kind === 'asset' ? 'serialized_assets' : 'quantity_items')
        .select('version::text')
        .eq('id', target.id)
        .limit(1)
        .abortSignal(signal)
        .maybeSingle(),
    );
    checkSignal(signal);
    if (!after) throw new Error('Current record unavailable');
    if (versionRow.parse(after).version !== before)
      throw new ChangedDuringRead();
    return peekPayloadSchema.parse(payload);
  };
  const photosForParent = () =>
    readFileListSummaries(context, [target], signal).catch((error) => {
      if (accessDenied(error)) throw error;
      checkSignal(signal);
      return [];
    });
  // Parent readability precedes thumbnail authorization. At most five additional
  // bounded reads; no history, custom metadata or complete location catalogue.
  if (target.kind === 'asset') {
    const row = z
      .object({
        id: z.uuid(),
        name: z.string(),
        status: z.enum(['active', 'retired']),
        asset_tag: z.string().nullable(),
        location_id: z.uuid().nullable(),
        site_id: z.uuid().nullable(),
      })
      .parse(parent);
    if (row.id.toLowerCase() !== target.id.toLowerCase())
      throw new Error('Record identity unavailable');
    const [photos, endpoint] = await Promise.all([
      photosForParent(),
      row.site_id
        ? supabase
            .from('sites')
            .select('name')
            .eq('id', row.site_id)
            .limit(1)
            .abortSignal(signal)
            .maybeSingle()
            .then(data)
        : row.location_id
          ? supabase
              .from('inventory_locations')
              .select(locationColumns)
              .eq('id', row.location_id)
              .limit(1)
              .abortSignal(signal)
              .maybeSingle()
              .then(data)
          : Promise.resolve(null),
    ]);
    if ((row.site_id || row.location_id) && !endpoint)
      throw new Error('Current location unavailable');
    const photo = photos.find(
      (entry) =>
        entry.kind === target.kind &&
        entry.id.toLowerCase() === target.id.toLowerCase(),
    );
    return finish({
      ...base,
      name: row.name,
      status: row.status,
      assetTag: row.asset_tag,
      siteName: row.site_id
        ? z.object({ name: z.string() }).parse(endpoint).name
        : null,
      locations: !row.site_id && endpoint ? [location(endpoint)] : [],
      photo: photo?.thumbnail_path
        ? { path: photo.thumbnail_path, name: photo.photo_name ?? row.name }
        : null,
    });
  }
  const row = z
    .object({ id: z.uuid(), name: z.string(), archived: z.boolean() })
    .parse(parent);
  if (row.id.toLowerCase() !== target.id.toLowerCase())
    throw new Error('Record identity unavailable');
  const [photos, totals, balances] = await Promise.all([
    photosForParent(),
    supabase
      .from('inventory_quantity_totals')
      .select('available_quantity,assigned_quantity,recorded_quantity')
      .eq('item_id', target.id)
      .limit(1)
      .abortSignal(signal)
      .maybeSingle()
      .then(data),
    supabase
      .from('stock_balances')
      .select('location_id,quantity')
      .eq('item_id', target.id)
      .gt('quantity', 0)
      .order('location_id')
      .limit(4)
      .abortSignal(signal)
      .then(data),
  ]);
  if (!totals || !balances) throw new Error('Stock summary unavailable');
  const holdings = z
    .array(
      z.object({
        location_id: z.uuid(),
        quantity: z.number().int().positive().max(2147483647),
      }),
    )
    .max(4)
    .parse(balances);
  const ids = holdings.slice(0, 3).map((holding) => holding.location_id);
  const refs = ids.length
    ? data(
        await supabase
          .from('inventory_locations')
          .select('id,' + locationColumns)
          .in('id', ids)
          .limit(3)
          .abortSignal(signal),
      )
    : [];
  if (!refs || refs.length !== ids.length)
    throw new Error('Current locations unavailable');
  const stock = z
    .object({
      available_quantity: z.string(),
      assigned_quantity: z.string(),
      recorded_quantity: z.string(),
    })
    .parse(totals);
  const photo = photos.find(
    (entry) =>
      entry.kind === target.kind &&
      entry.id.toLowerCase() === target.id.toLowerCase(),
  );
  return finish({
    ...base,
    name: row.name,
    status: row.archived ? 'archived' : 'active',
    stock: {
      available: stock.available_quantity,
      assigned: stock.assigned_quantity,
      recorded: stock.recorded_quantity,
    },
    locations: refs.map(location),
    moreLocations: holdings.length > 3,
    photo: photo?.thumbnail_path
      ? { path: photo.thumbnail_path, name: photo.photo_name ?? row.name }
      : null,
  });
}
