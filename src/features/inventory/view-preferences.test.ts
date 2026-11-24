import { expect, it } from 'vitest';
import {
  applyPreferences,
  columnMappingCsv,
  decodeSavedViews,
  emptySavedViews,
  encodeSavedViews,
  inventoryViewParams,
  readViewPreferences,
  savedViewStorageKey,
} from './view-preferences';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
it('keeps display keys in navigation and filters separate from CSV scope', () => {
  expect(
    inventoryViewParams({
      q: ' Cable ',
      view: 'holdings',
      density: 'compact',
      columns: id(1),
      page: '9',
    }).toString(),
  ).toBe(`q=Cable&view=holdings&density=compact&columns=${id(1)}`);
  expect(
    applyPreferences(
      { q: ' Cable ', page: '9' },
      { view: 'items', density: 'compact', columns: [id(1)] },
    ).get('page'),
  ).toBeNull();
});
it.each([
  { view: 'broken' },
  { density: 'broken' },
  { columns: 'not-an-id' },
  { columns: `${id(1)},${id(1)}` },
  { columns: Array.from({ length: 7 }, (_, i) => id(i)).join(',') },
])(
  'rejects invalid display state without losing the URL error: %j',
  (input) => {
    expect(readViewPreferences(input).error).toBeTruthy();
    for (const [key, value] of Object.entries(input))
      expect(inventoryViewParams(input).get(key)).toBe(value);
  },
);
it('scopes personal settings by caller UUID and backend origin', () => {
  expect(savedViewStorageKey(id(1), 'https://one.supabase.co/path')).toBe(
    savedViewStorageKey(id(1), 'https://one.supabase.co/another'),
  );
  expect(savedViewStorageKey(id(1), 'https://one.supabase.co')).not.toBe(
    savedViewStorageKey(id(2), 'https://one.supabase.co'),
  );
  expect(savedViewStorageKey(id(1), 'https://one.supabase.co')).not.toBe(
    savedViewStorageKey(id(1), 'https://two.supabase.co'),
  );
});
it('round trips allowlisted preferences and rejects records, secrets, unbounded names/counts/bytes', () => {
  const value = {
    ...emptySavedViews(),
    views: [
      {
        id: id(1),
        name: 'Cables',
        params: {
          q: 'Cable',
          view: 'items' as const,
          density: 'compact' as const,
          columns: id(2),
        },
      },
    ],
  };
  expect(decodeSavedViews(encodeSavedViews(value))).toEqual(value);
  expect(() =>
    decodeSavedViews(
      JSON.stringify({
        ...value,
        inventory: [{ name: 'Cached private record' }],
      }),
    ),
  ).toThrow();
  expect(() =>
    decodeSavedViews(
      JSON.stringify({
        ...value,
        views: [
          {
            ...value.views[0],
            params: { ...value.views[0].params, token: 'private' },
          },
        ],
      }),
    ),
  ).toThrow();
  expect(() =>
    encodeSavedViews({
      ...value,
      views: Array.from({ length: 21 }, (_, i) => ({
        ...value.views[0],
        id: id(i),
      })),
    }),
  ).toThrow();
  expect(() =>
    encodeSavedViews({
      ...value,
      views: [{ ...value.views[0], name: 'a'.repeat(81) }],
    }),
  ).toThrow();
  expect(() => decodeSavedViews(' '.repeat(65537))).toThrow(/limit/);
});
it('exports a separate safe identity mapping with Unicode, CSV quoting and historical label provenance', () => {
  const csv = columnMappingCsv([
    { id: id(1), label: '=SUM("é",1)', category: 'Cables', legacy: true },
  ]);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"\'=SUM(""é"",1)"');
  expect(csv).toContain(id(1));
  expect(csv).toContain('Latest published historical label');
  expect(csv.endsWith('\r\n')).toBe(true);
});
