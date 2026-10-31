import { expect, it } from 'vitest';
import {
  roomSelectionOccupancy,
  roomAdoptedOccupancy,
  createRoomOccupancyCapture,
  readCommittedRoomOccupancy,
  MAX_ROOM_OCCUPANCY_RESPONSES,
} from '../e2e/room-occupancy-snapshot';
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

function captureResponse(
  value = input(),
  body = () => Promise.resolve<unknown>(value.response),
) {
  return {
    ok: () => true,
    url: () => value.requestUrl,
    request: () => ({ url: () => value.requestUrl }),
    headers: () => ({ 'cache-control': 'private, no-store' }),
    json: body,
  };
}
function nextInput(id: number, units = '99') {
  const value = input();
  const next = '00000000-0000-4000-8000-' + String(id).padStart(12, '0');
  value.requestUrl = value.requestUrl.replace(generation, next);
  value.response.identity.generation = next;
  value.acceptedGeneration = next;
  value.response.counts['ITC-RED'] = { ...count, quantity_unit_count: units };
  return value;
}
const commit = (value = generation) => ({
  code: 'ITC-RED',
  status: 'ready',
  generation: value,
});

it('models the CI retired-200 body failure and consumes eagerly before selection can retire it', async () => {
  let retired = false,
    calls = 0;
  const response = captureResponse(input(), () => {
    calls++;
    return retired
      ? Promise.reject(
          new Error(
            'ProtocolError: Network.getResponseBody No data found for resource',
          ),
        )
      : Promise.resolve(input().response);
  });
  const headers = Promise.resolve(response);
  retired = true;
  await expect((await headers).json()).rejects.toThrow(
    'Network.getResponseBody',
  );
  retired = false;
  calls = 0;
  const capture = createRoomOccupancyCapture(origin, 'it-closet');
  capture.observe(response);
  expect(calls).toBe(1); // This must happen before the subsequent selection/retirement.
  retired = true;
  expect(
    roomSelectionOccupancy({ ...input(), ...(await capture.read(generation)) }),
  ).toEqual({ generation, counts: count });
  expect(calls).toBe(1);
});

it('records an aborted unadopted200 but selects only the successfully adopted generation', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet');
  capture.observe(
    captureResponse(input(), () => Promise.reject(new Error('retired'))),
  );
  const adopted = nextInput(3);
  capture.observe(captureResponse(adopted));
  const observed = await readCommittedRoomOccupancy({
    capture,
    origin,
    spaceId: 'it-closet',
    code: 'ITC-RED',
    previousGeneration: previous,
    readCommit: async () => commit(adopted.acceptedGeneration),
    observe: async (counts) => counts['ITC-RED'].quantity_unit_count,
  });
  expect(observed.generation).toBe(adopted.acceptedGeneration);
  expect(observed.observation).toBe('99');
  expect(observed.cacheControl).toBe('private, no-store');
  await expect(capture.read(generation)).rejects.toThrow('unreadable');
});

it('never substitutes a later independent successful read for the render-adopted payload', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet');
  capture.observe(captureResponse());
  capture.observe(captureResponse(nextInput(3)));
  const observed = await readCommittedRoomOccupancy({
    capture,
    origin,
    spaceId: 'it-closet',
    code: 'ITC-RED',
    previousGeneration: previous,
    readCommit: async () => commit(),
    observe: async (counts) => counts['ITC-RED'],
  });
  expect(observed.generation).toBe(generation);
  expect(observed.observation).toEqual(count);
});

it('fails hard for an unreadable adopted generation even if another success is available', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet');
  let observations = 0;
  capture.observe(
    captureResponse(input(), () => Promise.reject(new Error('unavailable'))),
  );
  capture.observe(captureResponse(nextInput(3)));
  await expect(
    readCommittedRoomOccupancy({
      capture,
      origin,
      spaceId: 'it-closet',
      code: 'ITC-RED',
      previousGeneration: previous,
      readCommit: async () => commit(),
      observe: async () => {
        observations++;
      },
    }),
  ).rejects.toThrow('unreadable');
  expect(observations).toBe(0);
});

it('reacquires a legitimate refresh during observation without freezing the old generation', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet'),
    fresh = nextInput(3);
  capture.observe(captureResponse());
  capture.observe(captureResponse(fresh));
  let current = generation,
    observations = 0;
  const observed = await readCommittedRoomOccupancy({
    capture,
    origin,
    spaceId: 'it-closet',
    code: 'ITC-RED',
    previousGeneration: previous,
    readCommit: async () => commit(current),
    observe: async (counts) => {
      observations++;
      current = fresh.acceptedGeneration;
      return counts['ITC-RED'].quantity_unit_count;
    },
  });
  expect(observations).toBe(2);
  expect(observed.generation).toBe(fresh.acceptedGeneration);
  expect(observed.observation).toBe('99');
});

it('fails after at most four invalidated observation windows', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet'),
    values = Array.from({ length: 8 }, (_, i) => nextInput(i + 2));
  for (const value of values) capture.observe(captureResponse(value));
  let reads = 0,
    observations = 0;
  await expect(
    readCommittedRoomOccupancy({
      capture,
      origin,
      spaceId: 'it-closet',
      previousGeneration: previous,
      readCommit: async () => commit(values[reads++].acceptedGeneration),
      observe: async () => {
        observations++;
      },
    }),
  ).rejects.toThrow('bounded observation');
  expect(reads).toBe(8);
  expect(observations).toBe(4);
});

it.each(['off', 'loading', 'error', 'wrong-selection'])(
  'rejects a nonadopted %s render instead of borrowing a readable response',
  async (status) => {
    const capture = createRoomOccupancyCapture(origin, 'it-closet');
    capture.observe(captureResponse());
    await expect(
      readCommittedRoomOccupancy({
        capture,
        origin,
        spaceId: 'it-closet',
        code: 'ITC-RED',
        previousGeneration: previous,
        readCommit: async () => ({
          ...commit(),
          status: status === 'wrong-selection' ? 'ready' : status,
          code: status === 'wrong-selection' ? 'ITC-D01' : 'ITC-RED',
        }),
        observe: async () => undefined,
      }),
    ).rejects.toThrow('selected render');
  },
);

it('retains all exact snapshot identity checks after capture, including requestURL identity', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet');
  const wrong = captureResponse();
  wrong.request = () => ({ url: () => nextInput(3).requestUrl });
  capture.observe(wrong);
  await expect(
    readCommittedRoomOccupancy({
      capture,
      origin,
      spaceId: 'it-closet',
      previousGeneration: previous,
      readCommit: async () => commit(),
      observe: async () => undefined,
    }),
  ).rejects.toThrow('selection request');
  const tooMany = input();
  tooMany.response.counts = {
    ...tooMany.response.counts,
    ...Object.fromEntries(
      Array.from({ length: 100 }, (_, i) => [String(i), count]),
    ),
  };
  expect(() => roomAdoptedOccupancy(tooMany)).toThrow();
});

it('bounds captures, rejects ambiguous adopted duplicates, and never reads ignored bodies', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet');
  capture.observe(captureResponse());
  capture.observe(captureResponse());
  await expect(capture.read(generation)).rejects.toThrow('ambiguous');
  const other = nextInput(3);
  capture.observe(captureResponse(other));
  expect((await capture.read(other.acceptedGeneration)).kind).toBe('readable');
  const bounded = createRoomOccupancyCapture(origin, 'it-closet');
  let bodies = 0;
  for (let i = 0; i <= MAX_ROOM_OCCUPANCY_RESPONSES; i++)
    bounded.observe(
      captureResponse(nextInput(i + 2), () => {
        bodies++;
        return Promise.resolve(input().response);
      }),
    );
  expect(bodies).toBe(MAX_ROOM_OCCUPANCY_RESPONSES);
  await expect(bounded.read(generation)).rejects.toThrow('bounded out');
  const ignored = createRoomOccupancyCapture(origin, 'it-closet');
  let ignoredBodies = 0;
  for (const requestUrl of [
    input().requestUrl.replace(origin, 'https://other.invalid'),
    input().requestUrl.replace('it-closet', 'other'),
    input().requestUrl + '&generation=' + generation,
  ]) {
    const value = input();
    value.requestUrl = requestUrl;
    ignored.observe(
      captureResponse(value, () => {
        ignoredBodies++;
        return Promise.resolve(value.response);
      }),
    );
  }
  const failed = captureResponse();
  failed.ok = () => false;
  ignored.observe(failed);
  expect(ignoredBodies).toBe(0);
  await expect(ignored.read(generation)).rejects.toThrow('No captured');
  ignored.dispose();
  await expect(ignored.read(generation)).rejects.toThrow('disposed');
});

it('reacquires when refresh commits while the initially adopted body is still being consumed', async () => {
  const capture = createRoomOccupancyCapture(origin, 'it-closet'),
    fresh = nextInput(3);
  let finishBody!: (value: unknown) => void;
  capture.observe(
    captureResponse(
      input(),
      () =>
        new Promise((resolve) => {
          finishBody = resolve;
        }),
    ),
  );
  capture.observe(captureResponse(fresh));
  let current = generation,
    signal!: () => void;
  const started = new Promise<void>((resolve) => {
    signal = resolve;
  });
  const observed: string[] = [];
  const pending = readCommittedRoomOccupancy({
    capture,
    origin,
    spaceId: 'it-closet',
    code: 'ITC-RED',
    previousGeneration: previous,
    readCommit: async () => {
      const snapshot = commit(current);
      signal();
      return snapshot;
    },
    observe: async (counts) => {
      observed.push(counts['ITC-RED'].quantity_unit_count);
      return counts['ITC-RED'].quantity_unit_count;
    },
  });
  await started;
  current = fresh.acceptedGeneration;
  finishBody(input().response);
  const result = await pending;
  expect(result.generation).toBe(fresh.acceptedGeneration);
  expect(result.observation).toBe('99');
  expect(observed).toEqual(['44', '99']);
});

it.each(['duplicate', 'overflow', 'dispose'] as const)(
  'refuses %s introduced while an adopted body read is pending',
  async (reason) => {
    const capture = createRoomOccupancyCapture(origin, 'it-closet');
    let finish!: (value: unknown) => void;
    capture.observe(
      captureResponse(
        input(),
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const pending = capture.read(generation);
    if (reason === 'duplicate') capture.observe(captureResponse());
    if (reason === 'overflow')
      for (let i = 0; i < MAX_ROOM_OCCUPANCY_RESPONSES; i++)
        capture.observe(captureResponse(nextInput(i + 3)));
    if (reason === 'dispose') capture.dispose();
    finish(input().response);
    await expect(pending).rejects.toThrow('disposed, bounded out or ambiguous');
  },
);
