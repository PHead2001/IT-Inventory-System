/** Presentation only. Neither this scope nor its header authorizes a request. */
export const themeScopeHeader = 'x-inventory-theme-actor';
export function themeActor(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length === 36 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value.toLowerCase()
    : null;
}
export function themeScope(backend: string, actor: unknown) {
  return `app:${encodeURIComponent(new URL(backend).origin)}:${themeActor(actor) ?? 'anonymous'}`;
}
