// Proxy overwrites this header on matched routes, including every record route.
// It is a route selector, never an authorization grant.
export const documentPathHeader = 'x-inventory-document-path';

export function documentRecordRoute(pathname: string) {
  const match =
    /^(\/inventory\/(?:quantity|assets)|\/locations|\/sites|\/settings\/(?:sites|locations|forms))\/([^/]+)(?:\/open\/([^/]+))?\/?$/.exec(
      pathname,
    );
  if (!match) return null;
  const [, prefix, rawKey, rawKind] = match;
  if (rawKind !== undefined && prefix !== '/sites') return null;
  let key: string;
  let kind: string | undefined;
  try {
    key = decodeURIComponent(rawKey);
    kind = rawKind === undefined ? undefined : decodeURIComponent(rawKind);
  } catch {
    return null; // Next rejects malformed URL encodings before page admission.
  }
  if (prefix.startsWith('/inventory/') && rawKey === 'new') return null;
  return { prefix, key, kind };
}

export function isInventoryDocument(pathname: string) {
  return (
    documentRecordRoute(pathname)?.prefix.startsWith('/inventory/') ?? false
  );
}
