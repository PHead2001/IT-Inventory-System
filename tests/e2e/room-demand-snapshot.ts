import {
  ROOM_DEMAND_COUNTER_CAP,
  ROOM_DEMAND_MAX_BYTES,
  ROOM_DEMAND_REASONS,
  type RoomDemandSnapshot,
} from '../../src/features/room/scene/room-demand-diagnostics';
export type { RoomDemandSnapshot };
/** Browser reports fixed numeric counters only; reject malformed/foreign data. */
export function roomDemandSnapshot(value: unknown): RoomDemandSnapshot | null {
  try {
    if (!value || typeof value !== 'object') return null;
    const input = value as RoomDemandSnapshot;
    const count = (value: unknown): value is number =>
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= ROOM_DEMAND_COUNTER_CAP;
    if (
      input.schema !== 1 ||
      typeof input.bound !== 'boolean' ||
      input.preconnectObserved !== false ||
      typeof input.overflow !== 'boolean' ||
      !count(input.bindingCount) ||
      !input.counters
    )
      return null;
    const counters = Object.fromEntries(
      ROOM_DEMAND_REASONS.map((reason) => {
        const number = input.counters[reason];
        if (!count(number)) throw Error('invalid diagnostic');
        return [reason, number];
      }),
    ) as RoomDemandSnapshot['counters'];
    const result = {
      schema: 1 as const,
      bound: input.bound,
      preconnectObserved: false as const,
      bindingCount: input.bindingCount,
      overflow: input.overflow,
      counters,
    };
    return JSON.stringify(result).length <= ROOM_DEMAND_MAX_BYTES
      ? result
      : null;
  } catch {
    return null;
  }
}
