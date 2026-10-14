import type { LocationRef } from '@/features/inventory/contracts-ui';

export type LocationBrowserState = {
  query: string;
  selectedCode: string | null;
  levelCode: string | null | undefined;
  expandedCodes: string[];
};
export const emptyLocationBrowserState = (): LocationBrowserState => ({
  query: '',
  selectedCode: null,
  levelCode: undefined,
  expandedCodes: [],
});
const allowed = new Set(['q', 'selected', 'level', 'expanded']);
const safeCode = (value: string) =>
  value.length > 0 &&
  value.length <= 160 &&
  !/[\\/\x00-\x1f\x7f]/.test(value) &&
  value !== '.' &&
  value !== '..';

/** Structural URL validation; optional fresh authorized data resolves actual codes. */
export function parseLocationBrowserState(
  params: URLSearchParams,
  locations?: LocationRef[],
): LocationBrowserState | null {
  if (
    params.toString().length > 3600 ||
    [...params.keys()].some((key) => !allowed.has(key)) ||
    ['q', 'selected', 'level'].some((key) => params.getAll(key).length > 1) ||
    params.getAll('expanded').length > 32
  )
    return null;
  const query = params.get('q') ?? '';
  if (query.length > 200 || /[\x00-\x1f\x7f]/.test(query)) return null;
  const selected = params.get('selected'),
    level = params.get('level'),
    expanded = params.getAll('expanded');
  if (
    (selected !== null && !safeCode(selected)) ||
    (level !== null && level !== '' && !safeCode(level)) ||
    expanded.some((code) => !safeCode(code))
  )
    return null;
  const known = locations
    ? new Set(locations.map((location) => location.code))
    : null;
  const parentIds = new Set(locations?.map((location) => location.parentId));
  const groups = locations
    ? new Set(
        locations
          .filter((location) => parentIds.has(location.id))
          .map((location) => location.code),
      )
    : null;
  return {
    query,
    selectedCode: selected && (!known || known.has(selected)) ? selected : null,
    levelCode:
      level === null
        ? undefined
        : level === ''
          ? null
          : !groups || groups.has(level)
            ? level
            : undefined,
    expandedCodes: [...new Set(expanded)].filter(
      (code) => !groups || groups.has(code),
    ),
  };
}

/** One bounded draft scope; never a privacy/readiness key replacement. */
export function locationBrowserHref(
  state: LocationBrowserState,
  anchor?: string,
) {
  const params = new URLSearchParams();
  const query = state.query;
  if (query) params.set('q', query);
  if (state.selectedCode && safeCode(state.selectedCode))
    params.set('selected', state.selectedCode);
  if (
    state.levelCode !== undefined &&
    (state.levelCode === null || safeCode(state.levelCode))
  )
    params.set('level', state.levelCode ?? '');
  const expanded = [...new Set(state.expandedCodes)].sort();
  for (const code of expanded) params.append('expanded', code);
  return (
    '/locations' +
    (params.size ? '?' + params : '') +
    (anchor ? '#' + anchor : '')
  );
}
export function freshLocationBrowserState(
  state: LocationBrowserState,
  locations: LocationRef[],
) {
  return (
    parseLocationBrowserState(
      new URL(locationBrowserHref(state), 'https://inventory.invalid')
        .searchParams,
      locations,
    ) ?? emptyLocationBrowserState()
  );
}
