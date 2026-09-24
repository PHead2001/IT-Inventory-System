'use server';
import { requireMember } from '@/lib/auth/session.server';
import { getLabelOrigin } from '@/features/labels/origin.server';
import { ASSET_UUID, QUANTITY_UUID, parseScan } from './targets';

export type ScanMatch = {
  kind: 'location' | 'asset' | 'quantity';
  path: string;
  label: string;
  state: 'active' | 'inactive' | 'retired' | 'archived';
};
export type ScanResolution =
  | { status: 'invalid' | 'unknown'; matches: [] }
  | { status: 'found' | 'ambiguous'; matches: ScanMatch[] };

export async function resolveScan(value: string): Promise<ScanResolution> {
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
      .select('id,name,archived')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error('Quantity item lookup failed.');
    if (data)
      matches.push({
        kind: 'quantity',
        path: '/inventory/quantity/' + data.id,
        label: data.name,
        state: data.archived ? 'archived' : 'active',
      });
  }
  if (target.kind === 'tag' || target.kind === 'bare') {
    const tag = target.kind === 'tag' ? target.tag : target.identifier;
    // Existing asset tags are stored as lowercase trimmed text. Do not strip punctuation.
    const { data, error } = await supabase
      .from('serialized_assets')
      .select('id,name,status,asset_tag')
      .eq('asset_tag', tag.toLowerCase())
      .maybeSingle();
    if (error) throw new Error('Asset tag lookup failed.');
    if (
      data &&
      !matches.some((match) => match.path === '/inventory/assets/' + data.id)
    )
      matches.push(assetMatch(data));
  }
  if (matches.length === 0) return { status: 'unknown', matches: [] };
  return { status: matches.length > 1 ? 'ambiguous' : 'found', matches };
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
    state: data.status === 'retired' ? 'retired' : 'active',
  };
}
