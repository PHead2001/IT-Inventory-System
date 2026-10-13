import { expect, it } from 'vitest';
import {
  commandMatches,
  commands,
  ignoresShortcut,
  shortcutCommand,
} from './registry';
import {
  commandQuery,
  commandResults,
  entityRow,
  entityDestination,
  type EntityRow,
} from './contracts';
it.each([
  ['name', 200],
  ['code', 200],
  ['assetTag', 100],
  ['serialNumber', 200],
] as const)(
  'bounds response %s by Unicode codepoints like PostgreSQL',
  (field, limit) => {
    const row = {
      kind: 'asset',
      id: '11000000-0000-4000-8000-000000000001',
      name: 'Laptop',
      code: null,
      assetTag: null,
      serialNumber: null,
      status: 'active',
      matchedField: 'name',
    };
    for (const value of ['😀'.repeat(limit), 'x'.repeat(limit - 1) + '😀'])
      expect(entityRow.safeParse({ ...row, [field]: value }).success).toBe(
        true,
      );
    expect(
      entityRow.safeParse({ ...row, [field]: '😀'.repeat(limit + 1) }).success,
    ).toBe(false);
  },
);
it('keeps command IDs unique, typed, and staff-only tasks out of viewer search', () => {
  expect(new Set(commands.map((entry) => entry.id)).size).toBe(commands.length);
  expect(
    commandMatches('move', false).some((entry) => entry.id === 'move'),
  ).toBe(false);
  expect(
    commandMatches('scna', true).some((entry) => entry.id === 'scan'),
  ).toBe(true);
});
it.each(['s', 'l', 'n', '/', '?'])(
  'recognizes ordinary %s and preserves modifiers',
  (key) => {
    expect(
      shortcutCommand(new KeyboardEvent('keydown', { key }), false),
    ).not.toBeNull();
    expect(
      shortcutCommand(
        new KeyboardEvent('keydown', { key, altKey: true }),
        false,
      ),
    ).toBeNull();
    expect(
      shortcutCommand(
        new KeyboardEvent('keydown', { key, metaKey: true }),
        false,
      ),
    ).toBeNull();
  },
);
it('recognizes both platform palette keys, G navigation, and rejects modified K', () => {
  expect(
    shortcutCommand(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }),
      false,
    ),
  ).toBe('palette');
  expect(
    shortcutCommand(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
      false,
    ),
  ).toBe('palette');
  expect(
    shortcutCommand(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, altKey: true }),
      false,
    ),
  ).toBeNull();
  expect(
    shortcutCommand(new KeyboardEvent('keydown', { key: 'i' }), true),
  ).toBe('inventory');
  expect(
    shortcutCommand(new KeyboardEvent('keydown', { key: 'h' }), true),
  ).toBe('history');
  expect(
    shortcutCommand(new KeyboardEvent('keydown', { key: 'm' }), true),
  ).toBe('maps');
  expect(
    shortcutCommand(new KeyboardEvent('keydown', { key: 'x' }), true),
  ).toBeNull();
});
it.each([
  'input',
  'textarea',
  'select',
  '[contenteditable]',
  '[role="combobox"]',
  '[data-shortcut-scope="exclusive"]',
])('ignores focused %s', (selector) => {
  const target = selector.startsWith('[')
    ? document.createElement('div')
    : document.createElement(selector);
  if (selector === '[contenteditable]')
    target.setAttribute('contenteditable', 'true');
  if (selector === '[role="combobox"]') target.setAttribute('role', 'combobox');
  if (selector.includes('data-shortcut'))
    target.setAttribute('data-shortcut-scope', 'exclusive');
  document.body.append(target);
  let ignored = false;
  target.addEventListener('keydown', (event) => {
    ignored = ignoresShortcut(event, document);
  });
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 's', bubbles: true }),
  );
  expect(ignored).toBe(true);
  target.remove();
});
it.each(['dialog', 'alertdialog', 'menu', 'listbox'])(
  'does not stack over a %s',
  (role) => {
    const target = document.createElement('div');
    target.setAttribute('role', role);
    document.body.append(target);
    expect(
      ignoresShortcut(new KeyboardEvent('keydown', { key: 's' }), document),
    ).toBe(true);
    target.remove();
  },
);
it('ignores repeat, composition, legacy IME, prevented events, and an active scanner', () => {
  for (const options of [
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
  ])
    expect(
      ignoresShortcut(
        new KeyboardEvent('keydown', { key: 'n', ...options }),
        document,
      ),
    ).toBe(true);
  const event = new KeyboardEvent('keydown', { key: 'n', cancelable: true });
  event.preventDefault();
  expect(ignoresShortcut(event, document)).toBe(true);
  const camera = document.createElement('div');
  camera.dataset.scannerActive = 'true';
  document.body.append(camera);
  expect(
    ignoresShortcut(new KeyboardEvent('keydown', { key: 'n' }), document),
  ).toBe(true);
  camera.remove();
});
it('bounds Unicode characters and bytes, rejects controls and unknown scope, and trims outer whitespace', () => {
  expect(commandQuery.parse({ query: '  Camera  ' }).query).toBe('Camera');
  expect(commandQuery.safeParse({ query: '😀'.repeat(200) }).success).toBe(
    true,
  );
  expect(commandQuery.safeParse({ query: '😀'.repeat(201) }).success).toBe(
    false,
  );
  for (const query of ['x\n', '\u0085x', 'a'.repeat(201)])
    expect(commandQuery.safeParse({ query }).success).toBe(false);
  expect(
    commandQuery.safeParse({ query: 'valid', scope: 'hidden' }).success,
  ).toBe(false);
  expect(
    commandQuery.safeParse({ query: 'valid', purpose: 'hidden' }).success,
  ).toBe(false);
  expect(commandQuery.parse({ query: 'valid' }).purpose).toBe('all');
});
it('routes only known entities and typed tasks without printing or mutating', () => {
  const row: EntityRow = {
    kind: 'asset',
    id: '11000000-0000-4000-8000-000000000001',
    name: 'Laptop',
    code: null,
    assetTag: 'TAG',
    serialNumber: 'SERIAL',
    status: 'active',
    matchedField: 'name',
  };
  expect(entityDestination(row, 'move')).toBe(
    '/inventory/assets/' + row.id + '?task=asset_move',
  );
  expect(entityDestination({ ...row, status: 'retired' }, 'move')).toBeNull();
  expect(entityDestination(row, 'label')).toBe('/labels?asset=' + row.id);
  expect(
    entityDestination({ ...row, kind: 'site', code: 'SITE' }, 'label'),
  ).toBeNull();
  expect(
    commandResults.safeParse({
      version: 1,
      rows: Array.from({ length: 21 }, () => row),
      hasMore: true,
    }).success,
  ).toBe(false);
});
