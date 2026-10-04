import { expect, it } from 'vitest';
import { moveCompletionKey, parseMoveCompletion } from './move-completion';
const entityId = '00000000-0000-4000-8000-000000000010';
const eventId = '00000000-0000-4000-8000-000000000030';
it('bounds and validates an IDs-only receipt pointer', () => {
  expect(
    parseMoveCompletion(JSON.stringify({ entityId, eventId }), entityId),
  ).toEqual({ entityId, eventId });
  for (const raw of [
    'bad',
    'x'.repeat(257),
    JSON.stringify({ entityId, eventId, quantity: 1 }),
    JSON.stringify({ entityId: eventId, eventId }),
  ])
    expect(() => parseMoveCompletion(raw, entityId)).toThrow();
});
it('scopes the pointer by application origin, backend, actor and item', () => {
  const key = moveCompletionKey(
    'https://app',
    'https://backend',
    entityId,
    entityId,
  );
  for (const values of [
    ['https://other', 'https://backend', entityId, entityId],
    ['https://app', 'https://other', entityId, entityId],
    ['https://app', 'https://backend', eventId, entityId],
    ['https://app', 'https://backend', entityId, eventId],
  ])
    expect(
      moveCompletionKey(values[0], values[1], values[2], values[3]),
    ).not.toBe(key);
});
