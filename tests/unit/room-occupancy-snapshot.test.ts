import { expect, it } from 'vitest';
import { roomSelectionOccupancy } from '../e2e/room-occupancy-snapshot';
import { roomContentsFilter } from '../../src/features/room/contents-contract';

const origin = 'http://localhost:3000';
const previous = '00000000-0000-4000-8000-000000000001';
const generation = '00000000-0000-4000-8000-000000000002';
const count = {
  quantity_product_count: '6',
  quantity_unit_count: '44',
  asset_count: '3',
};
function input() {
  return {
    origin,
    spaceId: 'it-closet',
    code: 'ITC-RED',
    previousGeneration: previous,
    acceptedGeneration: generation,
    requestUrl: `${origin}/api/room/occupancy?space=it-closet&generation=${generation}`,
    response: {
      identity: {
        userId: 'staff',
        environment: origin,
        backend: 'http://localhost:54321',
        generation,
        spaceId: 'it-closet',
        filter: roomContentsFilter,
      },
      counts: { 'ITC-RED': count },
    },
  };
}

it('uses the exact new selection snapshot when concurrent stock differs from the preceding snapshot', () => {
  const before = input();
  before.response.counts['ITC-RED'] = {
    ...count,
    quantity_product_count: '7',
    quantity_unit_count: '45',
  };
  const earlier = roomSelectionOccupancy(before);
  const next = input();
  next.previousGeneration = earlier.generation;
  next.requestUrl = next.requestUrl.replace(generation, previous);
  next.response.identity.generation = previous;
  next.acceptedGeneration = previous;
  expect(roomSelectionOccupancy(next)).toEqual({
    generation: previous,
    counts: count,
  });
});

it.each([
  'reused-generation',
  'response-generation',
  'unaccepted-pair',
  'request-space',
  'response-space',
  'request-origin',
  'response-origin',
  'path',
  'duplicate-generation',
  'missing-code',
  'invalid-count',
] as const)(
  'rejects %s instead of borrowing another selection snapshot',
  (reason) => {
    const value = input();
    if (reason === 'reused-generation') value.previousGeneration = generation;
    if (reason === 'response-generation')
      value.response.identity.generation = previous;
    if (reason === 'unaccepted-pair') {
      const unrelated = '00000000-0000-4000-8000-000000000003';
      value.requestUrl = value.requestUrl.replace(generation, unrelated);
      value.response.identity.generation = unrelated;
    }
    if (reason === 'request-space')
      value.requestUrl = value.requestUrl.replace('it-closet', 'other');
    if (reason === 'response-space') value.response.identity.spaceId = 'other';
    if (reason === 'request-origin')
      value.requestUrl = value.requestUrl.replace(
        origin,
        'https://other.invalid',
      );
    if (reason === 'response-origin')
      value.response.identity.environment = 'https://other.invalid';
    if (reason === 'path')
      value.requestUrl = value.requestUrl.replace(
        '/api/room/occupancy',
        '/other',
      );
    if (reason === 'duplicate-generation')
      value.requestUrl += '&generation=' + generation;
    if (reason === 'missing-code') value.code = 'ITC-D01';
    if (reason === 'invalid-count')
      value.response.counts['ITC-RED'] = {
        ...count,
        quantity_unit_count: '-1',
      };
    expect(() => roomSelectionOccupancy(value)).toThrow();
  },
);
