/** Presentation capability only; server authorization/readiness remains canonical. */
export function supportsConventionalRoutePrimary(pathname: string) {
  if (['/inventory', '/history', '/locations'].includes(pathname)) return true;
  if (
    /^\/inventory\/(assets|quantity)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      pathname,
    )
  )
    return true;
  const location = /^\/locations\/([^/]+)$/.exec(pathname);
  if (!location) return false;
  try {
    const code = decodeURIComponent(location[1]);
    return (
      !!code &&
      !code.includes('/') &&
      code !== '.' &&
      code !== '..' &&
      encodeURIComponent(code) === location[1]
    );
  } catch {
    return false;
  }
}
