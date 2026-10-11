import { z } from 'zod';

// All persisted dimensions are integer tenths of a millimetre.
const dimension = z.number().int().min(320).max(5000);
const common = {
  version: z.literal(1),
  labelWidth: z.number().int().min(380).max(5000),
  labelHeight: dimension,
};
const sheet = z.strictObject({
  ...common,
  mode: z.literal('sheet'),
  sheetWidth: dimension,
  sheetHeight: dimension,
  marginTop: z.number().int().min(0).max(500),
  marginRight: z.number().int().min(0).max(500),
  marginBottom: z.number().int().min(0).max(500),
  marginLeft: z.number().int().min(0).max(500),
  gapX: z.number().int().min(0).max(250),
  gapY: z.number().int().min(0).max(250),
});
export const printLayoutSchema = z
  .discriminatedUnion('mode', [
    sheet,
    z.strictObject({ ...common, mode: z.literal('single') }),
  ])
  .refine(
    (value) =>
      value.mode === 'single' ||
      (value.labelWidth + value.marginLeft + value.marginRight <=
        value.sheetWidth &&
        value.labelHeight + value.marginTop + value.marginBottom <=
          value.sheetHeight),
    'At least one complete label must fit inside the sheet margins.',
  );
export type PrintLayout = z.infer<typeof printLayoutSchema>;
export type SheetGeometry = z.infer<typeof sheet> & {
  columns: number;
  rows: number;
  capacity: number;
};

export function sheetGeometry(
  size: '90x50' | '70x35',
  page: 'letter' | 'A4',
  layout?: PrintLayout | null,
): SheetGeometry {
  const [labelWidth, labelHeight] = size
    .split('x')
    .map((value) => Number(value) * 10);
  const validated = layout == null ? null : printLayoutSchema.parse(layout);
  const value: z.infer<typeof sheet> =
    validated?.mode === 'single'
      ? {
          ...validated,
          mode: 'sheet',
          sheetWidth: validated.labelWidth,
          sheetHeight: validated.labelHeight,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 0,
          marginLeft: 0,
          gapX: 0,
          gapY: 0,
        }
      : (validated ?? {
          version: 1,
          mode: 'sheet',
          labelWidth,
          labelHeight,
          sheetWidth: page === 'letter' ? 2159 : 2100,
          sheetHeight: page === 'letter' ? 2794 : 2970,
          marginTop: 80,
          marginRight: 80,
          marginBottom: 80,
          marginLeft: 80,
          gapX: 30,
          gapY: 30,
        });
  const columns = Math.floor(
    (value.sheetWidth - value.marginLeft - value.marginRight + value.gapX) /
      (value.labelWidth + value.gapX),
  );
  const rows = Math.floor(
    (value.sheetHeight - value.marginTop - value.marginBottom + value.gapY) /
      (value.labelHeight + value.gapY),
  );
  return { ...value, columns, rows, capacity: columns * rows };
}

export function defaultCustomLayout(
  size: '90x50' | '70x35',
  page: 'letter' | 'A4',
): PrintLayout {
  return sheet.strip().parse(sheetGeometry(size, page));
}

export type LayoutDraft = Record<string, string>;
export function layoutDraft(layout: PrintLayout): LayoutDraft {
  return Object.fromEntries(
    Object.entries(layout)
      .filter(([key]) => key !== 'version')
      .map(([key, value]) => [
        key,
        typeof value === 'number' ? (value / 10).toString() : value,
      ]),
  );
}
export function parseLayoutDraft(draft: LayoutDraft): PrintLayout | null {
  const fields =
    draft.mode === 'single'
      ? ['labelWidth', 'labelHeight']
      : [
          'labelWidth',
          'labelHeight',
          'sheetWidth',
          'sheetHeight',
          'marginTop',
          'marginRight',
          'marginBottom',
          'marginLeft',
          'gapX',
          'gapY',
        ];
  const value: Record<string, unknown> = { version: 1, mode: draft.mode };
  for (const field of fields) {
    const raw = draft[field];
    // No exponent, sign, whitespace, partial decimal, or silent rounding.
    if (!raw || !/^\d+(?:\.\d)?$/.test(raw)) return null;
    value[field] = Math.round(Number(raw) * 10);
  }
  const parsed = printLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
