import { expect, it } from 'vitest';
import { suggestSiteCode } from './site-code';

it('normalizes names into uppercase ASCII codes with single hyphen separators', () => {
  expect(suggestSiteCode('Oak Creek Apartments')).toBe('OAK-CREEK-APARTMENTS');
  expect(suggestSiteCode('  Café,  São-Paulo / West  ')).toBe(
    'CAFE-SAO-PAULO-WEST',
  );
});

it('bounds suggestions without leaving an invalid trailing separator', () => {
  expect(suggestSiteCode('A'.repeat(120))).toBe('A'.repeat(100));
  expect(suggestSiteCode(`${'A'.repeat(99)}!`)).toBe('A'.repeat(99));
});

it('returns no suggestion when normalization cannot produce a valid leading letter', () => {
  expect(suggestSiteCode('123 Oak Creek')).toBe('');
  expect(suggestSiteCode('---')).toBe('');
});
