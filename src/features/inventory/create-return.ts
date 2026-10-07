import { readFilters } from './read-model';
/** Only known relative in-app origins may receive whole-form Cancel navigation. */
export function inventoryReturnPath(
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
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.origin !== 'https://inventory.invalid' ||
      /[\\\x00-\x20]/.test(decodedPath) ||
      !(
        /^\/inventory$/.test(decodedPath) ||
        /^\/sites\/[^/]+$/.test(decodedPath)
      )
    )
      return fallback;
    const allowed = new Set([
      'q',
      'type',
      'status',
      'category',
      'location',
      'site',
      'lowStock',
      'page',
    ]);
    for (const key of [...url.searchParams.keys()])
      if (!allowed.has(key)) url.searchParams.delete(key);
    const normalized = readFilters(
      Object.fromEntries(
        [...url.searchParams.keys()].map((key) => [
          key,
          url.searchParams.get(key) ?? undefined,
        ]),
      ),
    );
    for (const key of [...url.searchParams.keys()]) {
      const canonical =
        key === 'q'
          ? normalized.query
          : key === 'page'
            ? String(normalized.page)
            : key === 'lowStock'
              ? normalized.lowStock
                ? 'true'
                : undefined
              : normalized[
                  key as 'type' | 'status' | 'category' | 'location' | 'site'
                ];
      if (canonical) url.searchParams.set(key, canonical);
      else url.searchParams.delete(key);
    }
    // Row ordinals preserve position without putting inventory IDs into telemetry selectors.
    const hash = /^#inventory-row-[1-9]\d{0,2}$/.test(url.hash) ? url.hash : '';
    return url.pathname + url.search + hash;
  } catch {
    return fallback;
  }
}
export function inventoryRowAnchor(index: number) {
  return `inventory-row-${index + 1}`;
}
export function inventoryRecordHref(
  kind: 'quantity' | 'asset',
  id: string,
  returnTo?: string,
) {
  const path = `/inventory/${kind === 'quantity' ? 'quantity' : 'assets'}/${encodeURIComponent(id)}`;
  return returnTo
    ? `${path}?${new URLSearchParams({ returnTo: inventoryReturnPath(returnTo) })}`
    : path;
}
