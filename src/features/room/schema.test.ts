import { describe, expect, it } from 'vitest';
import raw from '../../../data/rooms/it-closet.json';
import { roomSchema, type RoomNode } from './schema';
import { toScenePosition, toSceneSize } from './coordinates';
import { canHoldInventory } from '../locations/eligibility';
const flatten = (nodes: RoomNode[]): RoomNode[] =>
  nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
describe('IT closet contract', () => {
  const room = roomSchema.parse(raw);
  const nodes = flatten(room.nodes);
  const get = (code: string) => nodes.find((n) => n.locationCode === code)!;
  it('preserves measured envelope and opening', () => {
    expect(room.dimensions).toEqual([84, 126, 102]);
    expect(room.units).toBe('in');
    expect(room.coordinateSystem).toBe('x-right-y-back-z-up');
    expect(room.openings[0]).toMatchObject({
      wall: 'front',
      offset: 42,
      width: 36,
      height: 100,
    });
    expect(get('ITC-RACK')).toMatchObject({
      position: [30, 96, 40.5],
      size: [22, 24, 81],
    });
  });
  it('preserves all shelf spans, sections and top elevations', () => {
    for (let s = 1; s <= 4; s++)
      for (let i = 0; i < 3; i++) {
        const n = get('ITC-S' + s + 'ABC'[i]);
        const top = [81, 49, 62, 44][s - 1];
        expect(n.size).toEqual([16, 24, 1]);
        expect(n.position).toEqual([
          s <= 2 ? 8 : 76,
          (s <= 2 ? [18, 42, 66] : [98, 74, 50])[i],
          top - 0.5,
        ]);
        expect(n.measuredTopElevation).toBe(top);
      }
  });
  it('preserves twelve measured drawers and ordering assumption', () => {
    expect(room.assumptions.drawerOrdering).toContain(
      'right nearest back wall first',
    );
    for (let n = 1; n <= 12; n++) {
      const node = get('ITC-D' + String(n).padStart(2, '0'));
      const left = n <= 6,
        upper = left ? n <= 3 : n <= 9,
        h = upper ? 3 : 7,
        top = left ? (upper ? 45 : 41) : upper ? 41 : 37;
      expect(node.size).toEqual([16, 24, h]);
      expect(node.position).toEqual([
        left ? 8 : 76,
        (left ? [18, 42, 66] : [98, 74, 50])[(n - 1) % 3],
        top - h / 2,
      ]);
      expect(node.measuredTopElevation).toBe(top);
    }
  });
  it('distinguishes measured container sizes from tunable geometry', () => {
    expect(room.geometryBasis).toMatchObject({
      containerDimensions: 'measured',
      containerXY: 'visual-default',
      doorHinge: 'visual-default',
      shelfThickness: 'visual-default',
      drawerOrdering: 'assumption',
    });
    expect(get('ITC-RED').size).toEqual([19, 24, 12]);
    expect(get('ITC-BLACK').size).toEqual([20, 30, 14]);
    expect(get('ITC-CLEAR').size).toEqual([18, 25, 12]);
    expect(room.rackFaceProfiles.map((p) => [p.width, p.height])).toEqual([
      [19, 3],
      [19, 2],
      [19, 2],
    ]);
  });
  it('has unique primary bindings for 28 destinations', () => {
    expect(nodes.filter((n) => n.interaction?.primaryBinding)).toHaveLength(28);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });
  it('converts axes without changing the room contract', () => {
    expect(toScenePosition([10, 20, 30])).toEqual([10, 30, -20]);
    expect(toSceneSize([10, 20, 30])).toEqual([10, 30, 20]);
  });
  it.each([
    (r: typeof raw) => {
      r.schemaVersion = 2;
    },
    (r: typeof raw) => {
      r.units = 'cm';
    },
    (r: typeof raw) => {
      r.dimensions[0] = -1;
    },
    (r: typeof raw) => {
      r.dimensions[0] = Infinity;
    },
    (r: typeof raw) => {
      r.nodes[1].id = r.nodes[0].id;
    },
    (r: typeof raw) => {
      r.nodes[0].locationCode = 'not-a-code';
    },
    (r: typeof raw) => {
      r.openings[0].width = 90;
    },
    (r: typeof raw) => {
      Object.assign(r, { inventory: [] });
    },
    (r: typeof raw) => {
      r.geometryBasis.containerXY = 'measured';
    },
  ])('rejects an invalid definition', (mutate) => {
    const changed = structuredClone(raw);
    mutate(changed);
    expect(roomSchema.safeParse(changed).success).toBe(false);
  });
  it('checks capability flags independently of kind', () => {
    expect(canHoldInventory({ active: true, can_hold_inventory: true })).toBe(
      true,
    );
    expect(canHoldInventory({ active: false, can_hold_inventory: true })).toBe(
      false,
    );
    expect(canHoldInventory({ active: true, can_hold_inventory: false })).toBe(
      false,
    );
  });
});
