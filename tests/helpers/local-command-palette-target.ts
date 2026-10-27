/** Fail closed before constructing clients: pg connection-string query options
 * can override URL host/port even when the parsed URL appears to be loopback. */
export function localCommandPaletteTarget(
  value: string | undefined,
  kind: 'api' | 'database',
) {
  if (!value) throw new Error('Local timeout proof configuration is required');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Local timeout proof requires a valid URL');
  }
  if (url.search || url.hash || value.includes('?') || value.includes('#'))
    throw new Error('Local timeout proof refuses URL parameters and fragments');
  const protocols =
    kind === 'api' ? ['http:', 'https:'] : ['postgres:', 'postgresql:'];
  if (!protocols.includes(url.protocol))
    throw new Error('Local timeout proof refuses an unexpected protocol');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Local timeout proof refuses a nonlocal target');
  if (Number(url.port) !== (kind === 'api' ? 45321 : 45322))
    throw new Error('Local timeout proof refuses an unexpected port');
  return value;
}
