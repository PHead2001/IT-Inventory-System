import type { Page } from '@playwright/test';
import type { RootState } from '@react-three/fiber';
import { Box3, Matrix4, Ray, Vector3 } from 'three';
import type { RoomBinding } from '../../src/features/room/bindings';
import {
  roomWitnessCodeAtPoint,
  type WitnessSnapshot,
} from './room-visibility-witness';

type Point = { x: number; y: number };
export type RoomClickFrame = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export type RoomClickWitness = { client: Point; dispatch: Point };

/** Both actual click rays must miss the independent canonical resting volume
 * before the journey can claim a moved face outside that footprint. */
export function roomClickOutsideRest(
  snapshot: WitnessSnapshot,
  witness: RoomClickWitness,
  bounds: RoomBinding['bounds'],
) {
  const inverse = new Matrix4()
    .multiplyMatrices(
      new Matrix4().fromArray(snapshot.projection),
      new Matrix4().fromArray(snapshot.view),
    )
    .invert();
  const box = new Box3(
    new Vector3(bounds.min[0], bounds.min[2], -bounds.max[1]),
    new Vector3(bounds.max[0], bounds.max[2], -bounds.min[1]),
  );
  return [witness.client, witness.dispatch].every((point) => {
    const x = ((point.x - snapshot.frame.x) / snapshot.frame.width) * 2 - 1,
      y = 1 - ((point.y - snapshot.frame.y) / snapshot.frame.height) * 2;
    const origin = new Vector3(x, y, -1).applyMatrix4(inverse),
      far = new Vector3(x, y, 1).applyMatrix4(inverse);
    return (
      new Ray(origin, far.sub(origin).normalize()).intersectBox(
        box,
        new Vector3(),
      ) === null
    );
  });
}

/** Chromium floors absolute click clients, but independently rounds its local
 * offsets. Keep both rays truthful; fractional visibility witnesses stay intact. */
export function roomClickWitnesses(
  physical: WitnessSnapshot,
  selection: WitnessSnapshot,
  candidates: ReadonlyMap<string, readonly Point[]>,
  events: RoomClickFrame,
) {
  const frame = physical.frame;
  if (
    ![
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      events.left,
      events.top,
      events.width,
      events.height,
    ].every(Number.isFinite) ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    events.width <= 0 ||
    events.height <= 0 ||
    events.left !== frame.x ||
    events.top !== frame.y ||
    events.width !== frame.width ||
    events.height !== frame.height ||
    selection.frame.x !== frame.x ||
    selection.frame.y !== frame.y ||
    selection.frame.width !== frame.width ||
    selection.frame.height !== frame.height
  )
    throw new Error('Unsupported room click coordinate frame');
  const result = new Map<string, RoomClickWitness[]>();
  let samples = 0;
  for (const [code, points] of candidates) {
    const seen = new Set<string>();
    for (const candidate of points) {
      if (++samples > 10000)
        throw new Error('Room click witness bound exceeded');
      if (![candidate.x, candidate.y].every(Number.isFinite))
        throw new Error('Nonfinite room click witness');
      const client = { x: Math.floor(candidate.x), y: Math.floor(candidate.y) };
      const local = { x: client.x - events.left, y: client.y - events.top };
      // In-canvas offsets are nonnegative, where JS Math.round agrees with
      // Chromium std::round. Never use truncation or floor a local coordinate.
      if (
        local.x < 0 ||
        local.y < 0 ||
        local.x >= frame.width ||
        local.y >= frame.height
      )
        continue;
      const dispatch = {
        x: frame.x + (Math.round(local.x) / events.width) * frame.width,
        y: frame.y + (Math.round(local.y) / events.height) * frame.height,
      };
      const key = client.x + ',' + client.y;
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        [client, dispatch].every(
          (point) =>
            roomWitnessCodeAtPoint(physical, point) === code &&
            roomWitnessCodeAtPoint(selection, point) === code,
        )
      ) {
        const accepted = result.get(code) ?? [];
        accepted.push({ client, dispatch });
        result.set(code, accepted);
      }
    }
  }
  return result;
}

export async function uncoveredRoomClickWitnesses(
  page: Page,
  physical: WitnessSnapshot,
  selection: WitnessSnapshot,
  candidates: ReadonlyMap<string, readonly Point[]>,
) {
  const events = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-room-surface] canvas',
    );
    if (!canvas) throw new Error('Room click canvas unavailable');
    for (
      let element: HTMLElement | null = canvas;
      element;
      element = element.parentElement
    ) {
      const style = getComputedStyle(element);
      if (
        style.transform !== 'none' ||
        style.translate !== 'none' ||
        style.rotate !== 'none' ||
        style.scale !== 'none' ||
        style.perspective !== 'none' ||
        (style.zoom !== '1' && style.zoom !== 'normal')
      )
        throw new Error('Transformed room click canvas unsupported');
    }
    const style = getComputedStyle(canvas);
    if (
      [
        'borderLeftWidth',
        'borderRightWidth',
        'borderTopWidth',
        'borderBottomWidth',
        'paddingLeft',
        'paddingRight',
        'paddingTop',
        'paddingBottom',
      ].some(
        (name) =>
          parseFloat(style[name as keyof CSSStyleDeclaration] as string) !== 0,
      )
    )
      throw new Error('Bordered or padded room click canvas unsupported');
    const states = [...(window.__roomWitnessStores ?? [])]
      .map((store) => store.getState() as RootState)
      .filter((state) => state.gl.domElement === canvas);
    if (states.length !== 1)
      throw new Error('Room click event frame unavailable');
    const rect = canvas.getBoundingClientRect();
    if (
      rect.width !== states[0].size.width ||
      rect.height !== states[0].size.height
    )
      throw new Error('Unsupported room click coordinate frame');
    return {
      left: rect.left,
      top: rect.top,
      width: states[0].size.width,
      height: states[0].size.height,
    };
  });
  const normalized = roomClickWitnesses(
    physical,
    selection,
    candidates,
    events,
  );
  const samples = [...normalized].flatMap(([code, points]) =>
    points.map((point) => ({ code, ...point })),
  );
  const uncovered = await page.evaluate((points) => {
    const canvas = document.querySelector('[data-room-surface] canvas');
    return points.filter(
      ({ client, dispatch }) =>
        document.elementFromPoint(client.x, client.y) === canvas &&
        document.elementFromPoint(dispatch.x, dispatch.y) === canvas,
    );
  }, samples);
  const result = new Map<string, RoomClickWitness[]>();
  for (const { code, client, dispatch } of uncovered) {
    const points = result.get(code) ?? [];
    points.push({ client, dispatch });
    result.set(code, points);
  }
  return result;
}
