import type { LocationRef } from '../inventory/contracts-ui';

export type PickerMode = 'browse' | 'destination' | 'source';

const natural = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

export function pickerValue(location: LocationRef, mode: PickerMode) {
  return mode === 'browse' ? location.code : location.id;
}

export function orderedLocations(locations: LocationRef[]): LocationRef[] {
  const siblings = new Map<string | null, LocationRef[]>();
  const ids = new Set(locations.map((location) => location.id));
  for (const location of locations) {
    const parent =
      location.parentId && ids.has(location.parentId)
        ? location.parentId
        : null;
    const list = siblings.get(parent) ?? [];
    list.push(location);
    siblings.set(parent, list);
  }
  for (const list of siblings.values()) {
    list.sort(
      (a, b) =>
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
          (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        natural.compare(a.name, b.name) ||
        natural.compare(a.code, b.code),
    );
  }
  const result: LocationRef[] = [];
  const seen = new Set<string>();
  function visit(location: LocationRef) {
    if (seen.has(location.id)) return;
    seen.add(location.id);
    result.push(location);
    for (const child of siblings.get(location.id) ?? []) visit(child);
  }
  for (const root of siblings.get(null) ?? []) visit(root);
  // Defensive against corrupt hierarchy data; never hide an otherwise readable row.
  for (const location of locations) visit(location);
  return result;
}

export function pickerLocations(
  locations: LocationRef[],
  mode: PickerMode,
  options: { excludeIds?: string[]; sourceIds?: string[]; query?: string } = {},
) {
  const excluded = new Set(options.excludeIds ?? []);
  const sources = new Set(options.sourceIds ?? []);
  const query = (options.query ?? '').trim().toLocaleLowerCase();
  return orderedLocations(locations).filter((location) => {
    if (
      mode === 'destination' &&
      (!location.active ||
        !location.can_hold_inventory ||
        excluded.has(location.id))
    )
      return false;
    if (mode === 'source' && !sources.has(location.id)) return false;
    if (!query) return true;
    return [location.name, location.code, location.breadcrumb].some((text) =>
      text.toLocaleLowerCase().includes(query),
    );
  });
}

export function locationContext(location: LocationRef) {
  const parts = location.breadcrumb.split(' / ');
  return parts.slice(0, -1).join(' / ');
}
