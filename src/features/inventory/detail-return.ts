import { inventoryReturnPath } from './create-return';
import {
  parseLocationBrowserState,
  locationBrowserHref,
} from '@/features/room/location-browser-state';
export const presentationUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type LocationOccurrence =
  'desktop-tree' | 'mobile-level' | 'selected-panel';
export function locationRowAnchor(id: string, occurrence: LocationOccurrence) {
  return `location-row-${occurrence}-${id}`;
}

/** Detail navigation only. Whole-form Cancel/global inventory return policy is unchanged. */
export function recordDetailReturnPath(
  value: unknown,
  fallback = '/inventory',
): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\x00-\x20]/.test(value) ||
    value.length > 4000 ||
    /%(?![\da-f]{2})/i.test(value)
  )
    return fallback;
  try {
    const url = new URL(value, 'https://inventory.invalid');
    if (
      url.origin !== 'https://inventory.invalid' ||
      url.username ||
      url.password
    )
      return fallback;
    if (url.pathname === '/inventory' || /^\/sites\/[^/]+$/.test(url.pathname))
      return inventoryReturnPath(value, fallback);
    if (url.pathname === '/history') {
      const keys = new Set(['type', 'location', 'entityId', 'page']);
      if (
        [...url.searchParams.keys()].some((key) => !keys.has(key)) ||
        [...keys].some((key) => url.searchParams.getAll(key).length > 1)
      )
        return fallback;
      const params = new URLSearchParams();
      const type = url.searchParams.get('type');
      if (type && type !== 'all' && type !== 'asset' && type !== 'quantity')
        return fallback;
      if (type && type !== 'all') params.set('type', type);
      const location = url.searchParams.get('location');
      if (location) {
        if (location.length > 160 || /[\\/\x00-\x1f\x7f]/.test(location))
          return fallback;
        params.set('location', location);
      }
      const entity = url.searchParams.get('entityId');
      if (entity) {
        if (!presentationUuid.test(entity)) return fallback;
        params.set('entityId', entity);
      }
      const page = url.searchParams.get('page');
      if (page) {
        if (!/^[1-9]\d{0,5}$/.test(page)) return fallback;
        if (page !== '1') params.set('page', page);
      }
      const hash =
        /^#history-event-(asset|quantity)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          url.hash,
        )
          ? url.hash
          : '';
      return '/history' + (params.size ? '?' + params : '') + hash;
    }
    if (url.pathname === '/locations') {
      const state = parseLocationBrowserState(url.searchParams);
      if (!state) return fallback;
      const anchor =
        /^#location-row-(desktop-tree|mobile-level|selected-panel)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          url.hash,
        )
          ? url.hash.slice(1)
          : undefined;
      return locationBrowserHref(state, anchor);
    }
  } catch {
    return fallback;
  }
  return fallback;
}
export function detailRecordHref(
  kind: 'quantity' | 'asset',
  id: string,
  returnTo: string,
) {
  return (
    `/inventory/${kind === 'quantity' ? 'quantity' : 'assets'}/${encodeURIComponent(id)}?` +
    new URLSearchParams({ returnTo: recordDetailReturnPath(returnTo) })
  );
}
export function locationDetailReturnPath(value: unknown) {
  const path = recordDetailReturnPath(value, '/locations');
  return new URL(path, 'https://inventory.invalid').pathname === '/locations'
    ? path
    : '/locations';
}
