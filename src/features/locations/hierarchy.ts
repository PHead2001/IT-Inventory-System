import type { LocationRef } from '../inventory/contracts-ui';

/** Resolve inventory-bearing locations at or beneath a logical selection.
 * Database parent IDs and capability drive this set, never visual scene nesting.
 * Inactive locations remain discoverable; active controls mutation eligibility.
 */
export function inventoryDescendantCodes(
  locations: LocationRef[],
  selectedCode: string | null,
): string[] {
  if (!selectedCode) return [];
  const selected = locations.find((location) => location.code === selectedCode);
  if (!selected) return [];
  const children = new Map<string, string[]>();
  for (const location of locations) {
    if (location.parentId === null) continue;
    const siblings = children.get(location.parentId) ?? [];
    siblings.push(location.id);
    children.set(location.parentId, siblings);
  }
  const descendants = new Set<string>();
  const pending = [selected.id];
  while (pending.length) {
    const id = pending.pop()!;
    if (descendants.has(id)) continue;
    descendants.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return [
    ...new Set(
      locations
        .filter(
          (location) =>
            descendants.has(location.id) && location.can_hold_inventory,
        )
        .map((location) => location.code),
    ),
  ];
}
