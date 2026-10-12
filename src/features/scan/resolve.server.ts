'use server';
import { z } from 'zod';
import { requireMember } from '@/lib/auth/session.server';
import { getLabelOrigin } from '@/features/labels/origin.server';
import {
  itemCodeValid,
  normalizeItemCode,
} from '@/features/inventory/contracts';
import {
  ASSET_UUID,
  QUANTITY_UUID,
  parseScan,
  validIdentifier,
} from './targets';

export type ScanMatch = {
  kind: 'location' | 'asset' | 'quantity';
  path: string;
  label: string;
  name?: string;
  identifier?: string | null;
  state: 'active' | 'inactive' | 'retired' | 'archived';
  context?: string;
  serialNumber?: string;
};
export type ScanResolution =
  | { status: 'invalid' | 'unknown'; matches: []; truncated?: true }
  | { status: 'found' | 'ambiguous'; matches: ScanMatch[]; truncated?: true };

const itemCodeRow = z.object({
  id: z.uuid(),
  name: z.string(),
  archived: z.boolean(),
  item_code: z.string().nullable(),
});
const assetTagRow = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['active', 'retired']),
  asset_tag: z.string().nullable(),
});
const serialRow = assetTagRow.extend({
  serial_number: z.string(),
  manufacturer: z.string().nullable(),
  location_name: z.string().nullable(),
  location_code: z.string().nullable(),
  site_name: z.string().nullable(),
  site_code: z.string().nullable(),
});

async function lookupItemCode(value: string): Promise<ScanResolution> {
  const normalized = normalizeItemCode(value);
  if (!normalized || !itemCodeValid(normalized))
    return { status: 'invalid', matches: [] };
  const { supabase } = await requireMember();
  const { data, error } = await supabase.rpc('inventory_item_code_lookup', {
    p_code: value,
  });
  if (error?.code === 'P1012') return { status: 'invalid', matches: [] };
  if (error) throw new Error('Item code lookup failed.');
  const item = itemCodeRow.nullable().parse(data);
  if (!item) return { status: 'unknown', matches: [] };
  return {
    status: 'found',
    matches: [
      {
        kind: 'quantity',
        path: '/inventory/quantity/' + item.id,
        label: quantityLabel(item),
        name: item.name,
        identifier: item.item_code,
        state: item.archived ? 'archived' : 'active',
      },
    ],
  };
}

/** Manual exact quantity lookup; URL-like text remains data in this explicit mode. */
export async function resolveItemCode(value: string): Promise<ScanResolution> {
  if (typeof value !== 'string' || [...value].length > 128)
    return { status: 'invalid', matches: [] };
  return lookupItemCode(value);
}

export async function resolveScan(value: string): Promise<ScanResolution> {
  if (typeof value !== 'string' || value.length > 1024)
    return { status: 'invalid', matches: [] };
  value = value.trim();
  let origin = '';
  if (/^https?:/i.test(value)) {
    try {
      origin = getLabelOrigin().origin;
    } catch {
      return { status: 'invalid', matches: [] };
    }
  }
  const target = parseScan(value, origin);
  if (!target) return { status: 'invalid', matches: [] };
  const { supabase } = await requireMember();
  const matches: ScanMatch[] = [];
  let truncated = false;
  if (target.kind === 'location' || target.kind === 'bare') {
    const code = target.kind === 'location' ? target.code : target.identifier;
    const { data, error } = await supabase
      .from('inventory_locations')
      .select('code,name,active')
      .eq('code', code)
      .maybeSingle();
    if (error) throw new Error('Location lookup failed.');
    if (data)
      matches.push({
        kind: 'location',
        path: '/locations/' + data.code,
        label: `${data.name} (${data.code})`,
        name: String(data.name),
        identifier: String(data.code),
        state: data.active ? 'active' : 'inactive',
      });
  }
  if (
    target.kind === 'asset' ||
    (target.kind === 'bare' && ASSET_UUID.test(target.identifier))
  ) {
    const id = target.kind === 'asset' ? target.id : target.identifier;
    const { data, error } = await supabase
      .from('serialized_assets')
      .select('id,name,status,asset_tag')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error('Asset lookup failed.');
    if (data) matches.push(assetMatch(data));
  }
  if (
    target.kind === 'quantity' ||
    (target.kind === 'bare' && QUANTITY_UUID.test(target.identifier))
  ) {
    const id = target.kind === 'quantity' ? target.id : target.identifier;
    const { data, error } = await supabase
      .from('quantity_items')
      .select('id,name,archived,item_code')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error('Quantity item lookup failed.');
    if (data)
      matches.push({
        kind: 'quantity',
        path: '/inventory/quantity/' + data.id,
        label: quantityLabel(data),
        name: data.name,
        identifier: data.item_code,
        state: data.archived ? 'archived' : 'active',
      });
  }
  if (
    target.kind === 'tag' ||
    (target.kind === 'bare' && validIdentifier(target.identifier))
  ) {
    const tag = target.kind === 'tag' ? target.tag : target.identifier;
    // Preserve parsed spelling until PostgreSQL applies its own lower rule.
    const { data: raw, error } = await supabase.rpc(
      'inventory_asset_tag_lookup',
      { p_tag: tag },
    );
    if (error) throw new Error('Asset tag lookup failed.');
    const data = assetTagRow.nullable().parse(raw);
    if (
      data &&
      !matches.some((match) => match.path === '/inventory/assets/' + data.id)
    )
      matches.push(assetMatch(data));
  }
  if (target.kind === 'bare') {
    const itemResult = await lookupItemCode(target.identifier);
    if (
      itemResult.status === 'found' &&
      !matches.some((match) => match.path === itemResult.matches[0].path)
    )
      matches.push(itemResult.matches[0]);
    const { data, error } = await supabase.rpc('inventory_serial_lookup_v1', {
      p_serial: target.identifier,
    });
    if (error) throw new Error('Serial lookup failed.');
    // One PostgreSQL snapshot supplies exact identity and current context.
    const serials = z.array(serialRow).max(21).parse(data);
    truncated = serials.length > 20;
    for (const row of serials.slice(0, 20)) {
      const match = assetMatch(row);
      match.serialNumber = row.serial_number;
      match.context = [
        row.manufacturer ? `Manufacturer: ${row.manufacturer}` : null,
        row.site_name
          ? `Assigned to ${row.site_name}${row.site_code ? ` (${row.site_code})` : ''}`
          : row.location_name
            ? `${row.status === 'retired' ? 'Last recorded storage' : 'At'} ${row.location_name}${row.location_code ? ` (${row.location_code})` : ''}`
            : 'Location unavailable',
      ]
        .filter(Boolean)
        .join(' · ');
      const existing = matches.findIndex((value) => value.path === match.path);
      if (existing >= 0) matches[existing] = match;
      else matches.push(match);
    }
  }
  truncated ||= matches.length > 20;
  const limit = truncated ? { truncated: true as const } : {};
  if (matches.length === 0) return { status: 'unknown', matches: [], ...limit };
  return {
    status: truncated || matches.length > 1 ? 'ambiguous' : 'found',
    matches: matches.slice(0, 20),
    ...limit,
  };
}

function quantityLabel(data: {
  name: string;
  item_code: string | null;
}): string {
  return `${data.name}${data.item_code ? ` (${data.item_code})` : ''}`;
}

function assetMatch(data: {
  id: string;
  name: string;
  status: string;
  asset_tag: string | null;
}): ScanMatch {
  return {
    kind: 'asset',
    path: '/inventory/assets/' + data.id,
    label: `${data.name}${data.asset_tag ? ` (${data.asset_tag})` : ''}`,
    name: data.name,
    identifier: data.asset_tag,
    state: data.status === 'retired' ? 'retired' : 'active',
  };
}
