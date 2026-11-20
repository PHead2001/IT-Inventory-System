import { z } from 'zod';
import { inventoryFilterParams } from './scope-presentation';
import { csvText } from './export';

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const preferenceSchema = z.strictObject({
  view: z.enum(['items', 'holdings']),
  density: z.enum(['comfortable', 'compact']),
  columns: z
    .array(uuid)
    .max(6)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type ViewPreferences = z.infer<typeof preferenceSchema>;
export const defaultPreferences: ViewPreferences = {
  view: 'items',
  density: 'comfortable',
  columns: [],
};
export function readViewPreferences(input: Record<string, string | undefined>) {
  const parsed = preferenceSchema.safeParse({
    view: input.view ?? 'items',
    density: input.density ?? 'comfortable',
    columns: input.columns ? input.columns.split(',') : [],
  });
  return parsed.success
    ? { preferences: parsed.data, error: null }
    : {
        preferences: defaultPreferences,
        error:
          'Choose Items or Holdings, a valid density, and at most six distinct custom fields. Clear display settings to recover.',
      };
}
/** Display state belongs in navigation, never in the existing holdings CSV scope. */
export function inventoryViewParams(input: Record<string, string | undefined>) {
  const params = inventoryFilterParams(input);
  // Preserve invalid display input so a filter navigation cannot silently clear its error.
  for (const key of ['view', 'density', 'columns', 'columnSearch'] as const)
    if (input[key]) params.set(key, input[key]);
  return params;
}
export function applyPreferences(
  input: Record<string, string | undefined>,
  prefs: ViewPreferences,
) {
  const params = inventoryFilterParams(input);
  params.set('view', prefs.view);
  params.set('density', prefs.density);
  if (prefs.columns.length) params.set('columns', prefs.columns.join(','));
  return params;
}
const savedParams = z
  .strictObject({
    q: z.string().max(200).optional(),
    type: z.enum(['quantity', 'asset']).optional(),
    status: z.enum(['historical', 'all']).optional(),
    category: uuid.optional(),
    location: z.string().min(1).max(100).optional(),
    site: uuid.optional(),
    lowStock: z.literal('true').optional(),
    view: z.enum(['items', 'holdings']),
    density: z.enum(['comfortable', 'compact']),
    columns: z.string().optional(),
  })
  .refine((params) => !readViewPreferences(params).error);
export const savedViewsSchema = z.strictObject({
  version: z.literal(1),
  preferences: preferenceSchema,
  views: z
    .array(
      z.strictObject({
        id: uuid,
        name: z.string().trim().min(1).max(80),
        params: savedParams,
      }),
    )
    .max(20)
    .refine(
      (views) => new Set(views.map(({ id }) => id)).size === views.length,
    ),
});
export type SavedViews = z.infer<typeof savedViewsSchema>;
export const emptySavedViews = (): SavedViews => ({
  version: 1,
  preferences: defaultPreferences,
  views: [],
});
export function encodeSavedViews(value: SavedViews) {
  const text = JSON.stringify(savedViewsSchema.parse(value));
  if (new TextEncoder().encode(text).length > 65536)
    throw new Error(
      'Saved views exceed the 64 KiB browser limit. Remove a view or shorten its filters.',
    );
  return text;
}
export function decodeSavedViews(text: string | null): SavedViews {
  if (!text) return emptySavedViews();
  if (new TextEncoder().encode(text).length > 65536)
    throw new Error('Saved views exceed the browser limit.');
  return savedViewsSchema.parse(JSON.parse(text));
}
export function savedViewStorageKey(userId: string, backend: string) {
  uuid.parse(userId);
  const origin = new URL(backend).origin;
  return `it-inventory:views:v1:${origin}:${userId}`;
}
export function columnMappingCsv(
  columns: { id: string; label: string; category: string; legacy: boolean }[],
) {
  if (columns.length > 6) throw new Error('Select at most six custom columns.');
  return (
    '\uFEFF' +
    [
      [
        'Display column',
        'Stable field ID',
        'Field label',
        'Category',
        'Label provenance',
      ]
        .map(csvText)
        .join(','),
      ...columns.map((column, index) =>
        [
          String(index + 1),
          uuid.parse(column.id),
          column.label,
          column.category,
          column.legacy
            ? 'Latest published historical label'
            : 'Current published label',
        ]
          .map(csvText)
          .join(','),
      ),
    ].join('\r\n') +
    '\r\n'
  );
}
