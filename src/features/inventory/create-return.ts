/** Only known relative in-app origins may receive whole-form Cancel navigation. */
export function inventoryReturnPath(
  value: unknown,
  fallback = '/inventory',
): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    /[\\\x00-\x20]/.test(value)
  )
    return fallback;
  try {
    const url = new URL(value, 'https://inventory.invalid');
    if (
      url.origin !== 'https://inventory.invalid' ||
      !(
        /^\/inventory$/.test(url.pathname) ||
        /^\/sites\/[^/]+$/.test(url.pathname)
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
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
