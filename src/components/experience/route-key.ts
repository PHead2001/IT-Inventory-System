export type RouteQuery = Record<string, string | string[] | undefined>;
/** Only UUID identity segments on known inventory record routes are case-insensitive. */
export function canonicalRecordPath(pathname: string) {
  return pathname.replace(
    /^(\/inventory\/(?:assets|quantity)\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    (match, prefix: string, id: string) =>
      /^\/inventory\/(?:assets|quantity)\/$/.test(prefix)
        ? prefix + id.toLowerCase()
        : match,
  );
}

/** Canonical key retains each repeated value in order; hashes remain anchors. */
export function routeKey(
  pathname: string,
  query: RouteQuery | URLSearchParams,
) {
  const parameters =
    query instanceof URLSearchParams
      ? new URLSearchParams(query)
      : new URLSearchParams();
  if (!(query instanceof URLSearchParams)) {
    for (const [key, values] of Object.entries(query)) {
      for (const value of Array.isArray(values)
        ? values
        : values === undefined
          ? []
          : [values])
        parameters.append(key, value);
    }
  }
  parameters.sort();
  return (
    canonicalRecordPath(pathname) + (parameters.size ? `?${parameters}` : '')
  );
}
