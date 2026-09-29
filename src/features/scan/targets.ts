/** The only destinations a printed label or login return may open. */
export const LOCATION_CODE = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
export const ASSET_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const QUANTITY_UUID = ASSET_UUID;

export type ScanTarget =
  | { kind: 'location'; code: string; path: string }
  | { kind: 'asset'; id: string; path: string }
  | { kind: 'quantity'; id: string; path: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'bare'; identifier: string };

export function targetPath(
  value: string,
): Extract<ScanTarget, { kind: 'location' | 'asset' | 'quantity' }> | null {
  if (
    value.length > 256 ||
    /[%\\?#\u0000-\u001f\u007f]/.test(value) ||
    !value.startsWith('/') ||
    value.startsWith('//')
  )
    return null;
  const location = /^\/locations\/([^/]+)$/.exec(value);
  if (location && LOCATION_CODE.test(location[1]))
    return { kind: 'location', code: location[1], path: value };
  const asset = /^\/inventory\/assets\/([^/]+)$/.exec(value);
  if (asset && ASSET_UUID.test(asset[1]))
    return { kind: 'asset', id: asset[1], path: value };
  const quantity = /^\/inventory\/quantity\/([^/]+)$/.exec(value);
  if (quantity && QUANTITY_UUID.test(quantity[1]))
    return { kind: 'quantity', id: quantity[1], path: value };
  return null;
}

export function validReturnPath(value: unknown): string | null {
  return typeof value === 'string' ? (targetPath(value)?.path ?? null) : null;
}

export function parseScan(value: string, origin: string): ScanTarget | null {
  if (
    value.length === 0 ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return null;
  const path = targetPath(value);
  if (path) return path;
  if (/^https?:/i.test(value)) {
    if (!/^https?:\/\//.test(value)) return null;
    if (/[?#%]/.test(value) || value.includes('@')) return null;
    try {
      const url = new URL(value);
      if (
        url.origin !== origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        value !== origin + url.pathname
      )
        return null;
      return targetPath(url.pathname);
    } catch {
      return null;
    }
  }
  if (value.startsWith('LOC:')) {
    const code = value.slice(4);
    return LOCATION_CODE.test(code)
      ? { kind: 'location', code, path: '/locations/' + code }
      : null;
  }
  if (value.startsWith('AST:')) {
    const tag = value.slice(4);
    return validIdentifier(tag) ? { kind: 'tag', tag } : null;
  }
  if (value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  // Exact database lookups decide whether a bare identifier is a location, a tag, or ambiguous.
  return validIdentifier(value) ? { kind: 'bare', identifier: value } : null;
}

export function validIdentifier(value: string): boolean {
  return (
    [...value].length >= 1 &&
    [...value].length <= 100 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f-\u009f]/.test(value)
  );
}

/** Code 128 can carry printable ASCII; a wider human tag still works with QR/manual lookup. */
export function barcodeCompatibleTag(tag: string): boolean {
  return validIdentifier(tag) && /^[\x20-\x7e]+$/.test(tag);
}

export function locationLabelPath(code: string): string {
  if (!LOCATION_CODE.test(code)) throw new Error('Invalid location code');
  return '/locations/' + code;
}

export function assetLabelPath(id: string): string {
  if (!ASSET_UUID.test(id)) throw new Error('Invalid asset ID');
  return '/inventory/assets/' + id;
}
export function quantityLabelPath(id: string): string {
  if (!QUANTITY_UUID.test(id)) throw new Error('Invalid quantity item ID');
  return '/inventory/quantity/' + id;
}
