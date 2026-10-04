import { expect, it } from 'vitest';
import { consumedLabelUrl, labelIntentKeys } from './add-intent';
const id = 'd6a2c785-1489-4dd0-83ea-d8dc2f249711';
it('consumes only handled additions while preserving unrelated state and hash', () => {
  expect(
    consumedLabelUrl(
      '/labels',
      `asset=${id}&location=ITC-RED&keep=one&keep=two`,
      [`asset:${id}`],
      '#sheet',
    ),
  ).toBe('/labels?location=ITC-RED&keep=one&keep=two#sheet');
  expect(consumedLabelUrl('/labels', `asset=${id}`, ['location:ITC-RED'])).toBe(
    `/labels?asset=${id}`,
  );
});
it('validates all existing add-link variants and normalizes UUID case without inventing identifiers', () => {
  expect(
    labelIntentKeys({
      asset: id.toUpperCase(),
      quantity: id,
      location: 'ITC-RED',
    }),
  ).toEqual([
    { kind: 'location', key: 'ITC-RED' },
    { kind: 'asset', key: id },
    { kind: 'quantity', key: id },
  ]);
  expect(
    labelIntentKeys({ asset: 'bad', quantity: 'bad', location: 'bad' }),
  ).toEqual([]);
  expect(labelIntentKeys({ asset: [id] as unknown as string })).toEqual([]);
});
