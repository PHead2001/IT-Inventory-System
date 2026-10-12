import { expect, it } from 'vitest';
import fixtures from '../../../tests/fixtures/print-media.json';
import {
  defaultCustomLayout,
  layoutDraft,
  parseLayoutDraft,
  printLayoutSchema,
  sheetGeometry,
} from './print-layout';
import { parseConfigurationCommand } from '@/features/configuration/contracts';

it.each(fixtures)(
  'validates $name (shared SQL agreement corpus)',
  ({ layout, valid }) => {
    expect(printLayoutSchema.safeParse(layout).success).toBe(valid);
  },
);
it.each([
  ['90x50', 'letter', 2, 5],
  ['90x50', 'A4', 2, 5],
  ['70x35', 'letter', 2, 7],
  ['70x35', 'A4', 2, 7],
] as const)(
  'fits %s on %s using whole rows and columns',
  (size, page, columns, rows) => {
    expect(sheetGeometry(size, page)).toMatchObject({
      columns,
      rows,
      capacity: columns * rows,
    });
  },
);
it('makes a single label the exact page with no margins or gaps', () => {
  expect(
    sheetGeometry('90x50', 'A4', {
      version: 1,
      mode: 'single',
      labelWidth: 700,
      labelHeight: 350,
    }),
  ).toMatchObject({
    sheetWidth: 700,
    sheetHeight: 350,
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    gapX: 0,
    gapY: 0,
    capacity: 1,
  });
});
it('retains raw incomplete inputs without rounding or unit coercion', () => {
  const draft = layoutDraft(defaultCustomLayout('90x50', 'letter'));
  expect(parseLayoutDraft(draft)).toEqual(
    defaultCustomLayout('90x50', 'letter'),
  );
  for (const raw of [
    '',
    '90.',
    '90.01',
    '9e1',
    ' 90',
    '+90',
    '-90',
    'NaN',
    'Infinity',
  ]) {
    expect(parseLayoutDraft({ ...draft, labelWidth: raw })).toBeNull();
  }
  expect(parseLayoutDraft({ ...draft, labelWidth: '90.1' })?.labelWidth).toBe(
    901,
  );
});
it('keeps old command receipt shapes separate from explicit clears', () => {
  const command = {
    operation: 'label_defaults_update',
    requestId: '00000000-0000-4000-8000-000000000001',
    payload: {
      expected_version: '1',
      size: '90x50',
      page: 'letter',
      format: 'qr',
    },
  };
  expect(parseConfigurationCommand(command)?.payload).toEqual(command.payload);
  expect(
    parseConfigurationCommand({
      ...command,
      payload: { ...command.payload, layout: null },
    })?.payload,
  ).toEqual({ ...command.payload, layout: null });
});
