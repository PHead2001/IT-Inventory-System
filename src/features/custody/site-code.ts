const CODE_PATTERN = /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)*$/;
const MAX_CODE_LENGTH = 100;

/** Build a valid, editable permanent-code suggestion from a site name. */
export function suggestSiteCode(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase()
    .slice(0, MAX_CODE_LENGTH)
    .replace(/-+$/g, '');

  return CODE_PATTERN.test(normalized) ? normalized : '';
}
