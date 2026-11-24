import {
  historyFilterKeys,
  historyFilterParams,
  parseHistoryFilters,
} from './history-filters';
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
    if (/^\/locations\/[^/]+$/.test(url.pathname)) {
      const accepted = inventoryReturnPath(value, '/invalid-return');
      if (accepted === '/invalid-return') return fallback;
      const parents = url.searchParams.getAll('returnTo');
      if (parents.length > 1) return fallback;
      if (parents.length === 0) return accepted;
      // Exactly one directory parent may survive the record-detail round trip.
      const canonicalParent = locationDetailReturnPath(parents[0], '');
      if (!canonicalParent) return fallback;
      const result = new URL(accepted, 'https://inventory.invalid');
      result.searchParams.set('returnTo', canonicalParent);
      return result.pathname + result.search + result.hash;
    }
    if (url.pathname === '/inventory' || /^\/sites\/[^/]+$/.test(url.pathname))
      return inventoryReturnPath(value, fallback);
    if (url.pathname === '/history') {
      const keys = new Set<string>([...historyFilterKeys, 'page']);
      if (
        [...url.searchParams.keys()].some((key) => !keys.has(key)) ||
        [...keys].some((key) => url.searchParams.getAll(key).length > 1)
      )
        return fallback;
      const input = Object.fromEntries(url.searchParams);
      if (!parseHistoryFilters(input).valid) return fallback;
      const location = input.location;
      if (
        location &&
        (location.length > 160 || /[\\/\x00-\x1f\x7f]/.test(location))
      )
        return fallback;
      const params = historyFilterParams(input, true);
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
export function locationDetailReturnPath(
  value: unknown,
  fallback = '/locations',
) {
  if (typeof value !== 'string') return fallback;
  try {
    const origin = new URL(value, 'https://inventory.invalid');
    // Check the directory route before calling the general detail validator.
    if (origin.pathname !== '/locations') return fallback;
    const path = recordDetailReturnPath(value, '');
    return path &&
      new URL(path, 'https://inventory.invalid').hash === origin.hash
      ? path
      : fallback;
  } catch {
    return fallback;
  }
}
