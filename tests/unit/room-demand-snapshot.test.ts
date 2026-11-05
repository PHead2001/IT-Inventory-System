import { expect, it } from 'vitest';
import { roomDemandSnapshot } from '../e2e/room-demand-snapshot';
import { ROOM_DEMAND_REASONS } from '../../src/features/room/scene/room-demand-diagnostics';
const fixture = () => ({
  schema: 1,
  bound: true,
  preconnectObserved: false,
  bindingCount: 1,
  overflow: false,
  counters: Object.fromEntries(ROOM_DEMAND_REASONS.map((key) => [key, 0])),
});
it('projects only fixed numeric source attribution and rejects malformed or throwing observations', () => {
  const input = { ...fixture(), privateText: 'must not leave the browser' };
  input.counters['camera-flight'] = 6;
  const result = roomDemandSnapshot(input)!;
  expect(result.counters['camera-flight']).toBe(6);
  expect(JSON.stringify(result)).not.toContain('privateText');
  for (const value of [
    null,
    {},
    { ...fixture(), bindingCount: -1 },
    { ...fixture(), preconnectObserved: true },
    { ...fixture(), overflow: 'false' },
    { ...fixture(), counters: { 'camera-flight': 6 } },
  ])
    expect(roomDemandSnapshot(value)).toBeNull();
  for (const value of [NaN, Infinity, -1, 1.1, 1_000_001]) {
    const bad = fixture();
    bad.counters['camera-flight'] = value;
    expect(roomDemandSnapshot(bad)).toBeNull();
  }
  expect(
    roomDemandSnapshot({
      get schema() {
        throw Error('secret');
      },
    }),
  ).toBeNull();
});
