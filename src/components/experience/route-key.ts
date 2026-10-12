export type RouteQuery = Record<string, string | string[] | undefined>;

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
  return pathname + (parameters.size ? `?${parameters}` : '');
}
