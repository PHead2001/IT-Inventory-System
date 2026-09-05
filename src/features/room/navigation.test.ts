import { describe, expect, it } from 'vitest';
import { parseRoomLocation, roomHref } from './navigation';

describe('room URL state', () => {
  it.each(['ITC', 'ITC-S1A', 'ITC-D12', 'SECOND-ROOM-D01'])(
    'accepts stable code %s without inventing scene identifiers',
    (code) => {
      expect(parseRoomLocation(code)).toBe(code);
      expect(roomHref(code)).toBe('/room?location=' + code);
    },
  );
  it.each([
    undefined,
    '',
    'itc-s1a',
    ' ITC ',
    'ITC--L',
    '../ITC',
    'ITC&other=1',
    ['ITC'],
    ['ITC', 'ITC-L'],
  ])('treats malformed or ambiguous selection %j as cleared', (value) =>
    expect(parseRoomLocation(value)).toBeNull(),
  );
  it('clears selection with the canonical route and encodes link values as one query value', () => {
    expect(roomHref(null)).toBe('/room');
    expect(roomHref('A&B')).toBe('/room?location=A%26B');
  });
});
