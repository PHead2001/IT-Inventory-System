import { describe, expect, it } from 'vitest';
import raw from '../../../../data/rooms/it-closet.json';
import { roomSchema, roomNodeSchema } from '../schema';
import { buildRoomBindings, findFocusBinding } from '../bindings';
import {
  createSpatialRevealController,
  focusToken,
  presentationBindings,
  revealOffset,
  sameFocusToken,
} from './spatial-reveal';

const token = (
  code: string | null,
  generation = 1,
  requestId = 0,
  scope = 'staff|origin|closet',
) => focusToken({ code, generation, requestId, scope }, 'fallback');
describe('spatial request lifecycle', () => {
  it('rejects an earlier A even after A to B to A and across scopes or repeated focus', () => {
    const controller = createSpatialRevealController();
    const first = token('ITC-D01'),
      second = token('ITC-D07', 2),
      third = token('ITC-D01', 3);
    controller.begin(first, true, 0);
    controller.begin(second, true, 10);
    controller.begin(third, true, 20);
    for (const stale of [
      first,
      second,
      token('ITC-D01', 3, 1),
      token('ITC-D01', 3, 0, 'another-user'),
    ])
      expect(controller.finishFlight(stale, 900)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      token: third,
      phase: 'flying',
      openCode: null,
    });
    expect(controller.finishFlight(third, 900)).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'revealing',
      openCode: 'ITC-D01',
    });
    expect(Object.isFrozen(third)).toBe(true);
  });
  it.each([null, 'MISSING'])(
    'clear or missing binding %s invalidates flight and queued reveal before old completion',
    (code) => {
      const controller = createSpatialRevealController(),
        old = token('ITC-RED');
      controller.begin(old, true, 0);
      controller.begin(token(code, 2), false, 20);
      expect(controller.finishFlight(old, 1000, true)).toBe(false);
      expect(controller.getSnapshot().openCode).toBeNull();
    },
  );
  it('camera interruption cancels flight permanently, including late reduced motion', () => {
    const controller = createSpatialRevealController(),
      current = token('ITC-BLACK');
    controller.begin(current, true, 0);
    controller.interrupt(current);
    expect(controller.finishFlight(current, 800)).toBe(false);
    expect(controller.finishFlight(current, 1000, true)).toBe(false);
    expect(controller.settle(current)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'cancelled',
      openCode: null,
    });
  });
  it('input during opening settles the selected endpoint; supersession closes only the old code', () => {
    const controller = createSpatialRevealController(),
      a = token('ITC-D01'),
      b = token('ITC-D07', 2);
    controller.begin(a, true, 0);
    controller.finishFlight(a, 750);
    controller.interrupt(a);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'settled',
      openCode: 'ITC-D01',
    });
    controller.begin(b, true, 800);
    controller.interrupt(a);
    expect(controller.settle(a)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'flying',
      openCode: null,
    });
    controller.finishFlight(b, 900, true);
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'settled',
      openCode: 'ITC-D07',
    });
  });
  it('same-code refocus keeps the open endpoint and unmount cannot resurrect it', () => {
    const controller = createSpatialRevealController(),
      a = token('ITC-RED'),
      refocus = token('ITC-RED', 1, 1);
    controller.begin(a, true, 0);
    controller.finishFlight(a, 750, true);
    controller.begin(refocus, true, 800);
    expect(controller.getSnapshot().openCode).toBe('ITC-RED');
    expect(sameFocusToken(a, refocus)).toBe(false);
    controller.dispose();
    expect(controller.finishFlight(refocus, 1500, true)).toBe(false);
    expect(controller.getSnapshot().openCode).toBeNull();
  });
});

describe('visual reveal geometry', () => {
  const room = roomSchema.parse(raw);
  it('has explicit bounded presentation defaults and keeps measured bindings untouched', () => {
    const rest = buildRoomBindings(room),
      original = structuredClone(rest);
    const framing = presentationBindings(room, rest);
    expect(rest).toEqual(original);
    const visit = (nodes: typeof room.nodes) => {
      for (const node of nodes) {
        if (node.visual?.style === 'drawer')
          expect(revealOffset(node)).toEqual([
            Number(node.locationCode!.slice(-2)) <= 6 ? 5.6 : -5.6,
            0,
            0,
          ]);
        if (node.visual?.style === 'shelf-section')
          expect(revealOffset(node)).toEqual([0, 0, 1]);
        if (node.visual?.style === 'container')
          expect(revealOffset(node)).toEqual([
            node.locationCode === 'ITC-RED' ? 4 : -4,
            0,
            0,
          ]);
        if (node.kind === 'group' || node.visual?.style === 'rack')
          expect(revealOffset(node)).toEqual([0, 0, 0]);
        visit(node.children ?? []);
      }
    };
    visit(room.nodes);
    expect(findFocusBinding(framing, 'ITC-D01')!.bounds.max[0]).toBeCloseTo(
      findFocusBinding(rest, 'ITC-D01')!.bounds.max[0] + 5.6,
    );
    expect(findFocusBinding(framing, 'ITC-D07')!.bounds.min[0]).toBeCloseTo(
      findFocusBinding(rest, 'ITC-D07')!.bounds.min[0] - 5.6,
    );
    expect(framing.map((binding) => binding.focusPoint)).toEqual(
      rest.map((binding) => binding.focusPoint),
    );
  });
  it.each([NaN, Infinity, -25, 25])(
    'rejects unsupported offset %s instead of introducing nonfinite geometry',
    (value) => {
      expect(
        roomNodeSchema.safeParse({
          id: 'box',
          kind: 'box',
          position: [0, 0, 0],
          rotationZDegrees: 0,
          size: [1, 1, 1],
          visual: {
            color: '#475569',
            opacity: 1,
            edges: true,
            reveal: { offset: [value, 0, 0] },
          },
        }).success,
      ).toBe(false);
    },
  );
  it('retains additive v1 support for room data without reveal metadata', () => {
    const legacy = structuredClone(room);
    const clear = (nodes: typeof room.nodes) => {
      for (const node of nodes) {
        if (node.visual) delete node.visual.reveal;
        clear(node.children ?? []);
      }
    };
    clear(legacy.nodes);
    expect(roomSchema.parse(legacy).schemaVersion).toBe(1);
    expect(buildRoomBindings(legacy)).toEqual(buildRoomBindings(room));
  });
});
