// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { themeActor, themeScope } from './theme-scope';
const source = readFileSync(
  new URL('../../../public/theme-bootstrap.v1.js', import.meta.url),
  'utf8',
);
function bootstrap(
  scope: string,
  entries: Record<string, string>,
  light = true,
  denied = false,
) {
  const root = {
    dataset: { themeScope: scope } as Record<string, string>,
    style: { colorScheme: '' },
  };
  const window = {
    localStorage: {
      getItem: (key: string) => {
        if (denied) throw new Error('Blocked');
        return entries[key] ?? null;
      },
    },
    matchMedia: () => ({ matches: light }),
    inventoryTheme: undefined as
      undefined | import('./theme-store').ThemeBootstrap,
  };
  runInNewContext(source, { document: { documentElement: root }, window });
  return { root, api: window.inventoryTheme! };
}
describe('parser-blocking theme bootstrap', () => {
  const actor = '11111111-1111-4111-8111-111111111111';
  const scope = themeScope('https://one.supabase.co', actor);
  it('defaults to Dark on OS-light and separates verified actor, anonymous and backend scopes', () => {
    const other = themeScope(
      'https://one.supabase.co',
      '22222222-2222-4222-8222-222222222222',
    );
    const key = `it-inventory:theme:v1:${scope}`;
    const entries = {
      [key]: JSON.stringify({ version: 1, preference: 'light' }),
    };
    expect(bootstrap(scope, entries).root.dataset.theme).toBe('light');
    for (const independent of [
      other,
      themeScope('https://one.supabase.co', null),
      themeScope('https://two.supabase.co', actor),
    ]) {
      expect(bootstrap(independent, entries).root.dataset.theme).toBe('dark');
    }
  });
  it.each(['dark', 'light', 'system'] as const)(
    'applies persisted %s before runtime with matching parser and colorScheme',
    (preference) => {
      const { root, api } = bootstrap(scope, {
        [`it-inventory:theme:v1:${scope}`]: JSON.stringify({
          version: 1,
          preference,
        }),
      });
      expect(root.dataset.themePreference).toBe(preference);
      expect(root.dataset.theme).toBe(preference === 'dark' ? 'dark' : 'light');
      expect(root.style.colorScheme).toBe(root.dataset.theme);
      expect(api.read(scope)).toBe(preference);
      expect(api.resolve(api.read(scope))).toBe(root.dataset.theme);
    },
  );
  it.each([
    '',
    'light',
    '{}',
    'null',
    '{"version":2,"preference":"light"}',
    '{"version":1,"preference":"future"}',
  ])('fails closed to Dark for invalid/future preference %s', (raw) => {
    expect(
      bootstrap(scope, { [`it-inventory:theme:v1:${scope}`]: raw }).root.dataset
        .theme,
    ).toBe('dark');
  });
  it('keeps storage-denied and OS-dark first paint deterministic', () => {
    expect(bootstrap(scope, {}, true, true).root.dataset.theme).toBe('dark');
    expect(
      bootstrap(
        scope,
        {
          [`it-inventory:theme:v1:${scope}`]:
            '{"version":1,"preference":"system"}',
        },
        false,
      ).root.dataset.theme,
    ).toBe('dark');
  });
  it('accepts only canonical UUID presentation subjects', () => {
    expect(themeActor(actor.toUpperCase())).toBe(actor);
    for (const value of [
      null,
      '',
      'staff',
      'anonymous',
      `${actor}\n`,
      `${actor},other`,
    ])
      expect(themeActor(value)).toBeNull();
  });
});
