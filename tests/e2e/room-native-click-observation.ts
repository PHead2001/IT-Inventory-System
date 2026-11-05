import type { JSHandle, Page } from '@playwright/test';
import type { RootState } from '@react-three/fiber';
import {
  roomWitnessCodeAtPoint,
  type WitnessSnapshot,
} from './room-visibility-witness';
import {
  roomClickWitnesses,
  type RoomClickWitness,
} from './room-click-witness';

type Point = { x: number; y: number };
type Frame = { x: number; y: number; width: number; height: number };
export type NativeRoomClickPhase = {
  phase: 'pointerdown' | 'pointerup' | 'click' | 'pointercancel';
  trusted: boolean;
  target: 'canvas' | 'room-control' | 'room-label' | 'other';
  targetLocationCode: string | null;
  client: Point;
  offset: Point;
  frame: Frame;
  size: { width: number; height: number };
  view: number[];
  projection: number[];
  worldTransformsUnchanged: boolean;
  moreExpanded: boolean;
  panel: {
    placement: 'above' | 'below' | 'inline' | 'other' | 'closed';
    frame: Frame | null;
  };
};
type Capture = {
  read: () => NativeRoomClickPhase[];
  stop: () => void;
};

const knownCode = (value: string | null) =>
  value === null
    ? null
    : /^ITC-(?:S[1-4][ABC]|D(?:0[1-9]|1[0-2])|RED|BLACK|CLEAR|RACK|L|R)$/.test(
          value,
        )
      ? value
      : 'other-location';

/** Compare the original hover coordinate with the actual native click contract.
 * This is computed before the one gesture; it never retries another target. */
export function originalClickAgreement(
  physical: WitnessSnapshot,
  selection: WitnessSnapshot,
  code: string,
  hover: Point,
) {
  const frame = physical.frame;
  const candidates = roomClickWitnesses(
    physical,
    selection,
    new Map([[code, [hover]]]),
    { left: frame.x, top: frame.y, width: frame.width, height: frame.height },
  );
  return {
    code: knownCode(code),
    hover,
    hoverPhysical: knownCode(roomWitnessCodeAtPoint(physical, hover)),
    hoverSelection: knownCode(roomWitnessCodeAtPoint(selection, hover)),
    normalizedClickAgrees: (candidates.get(code)?.length ?? 0) === 1,
  };
}

/** Event frames are observed after hover; the original witness triangles were
 * captured before hover. Until those geometry epochs are atomically bound, raw
 * event geometry is useful but projected owners must remain unknown. */
export function projectNativeClickPhases(
  phases: readonly NativeRoomClickPhase[],
) {
  if (phases.length > 4) throw new Error('Room native click phase bound');
  return phases.map((phase) => {
    const dispatch =
      phase.target === 'canvas'
        ? {
            x:
              phase.frame.x +
              (phase.offset.x / phase.size.width) * phase.frame.width,
            y:
              phase.frame.y +
              (phase.offset.y / phase.size.height) * phase.frame.height,
          }
        : null;
    return {
      ...phase,
      dispatch,
      ownerProjection: {
        epoch: 'unbound' as const,
        physical: null,
        selection: null,
      },
    };
  });
}

/** A bounded passive observer for exactly one native gesture. Capture listeners
 * read only public geometry/enums, never prevent/cancel/stop an event or request
 * a frame. Transform continuity is only since this observer's installation; it
 * does not bind the earlier pre-hover witness triangles to the event geometry. */
export async function observeNativeRoomClick(
  page: Page,
): Promise<JSHandle<Capture>> {
  return page.evaluateHandle(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-room-surface] canvas',
    );
    const stores = [...(window.__roomWitnessStores ?? [])].filter(
      (store) => store.getState().gl.domElement === canvas,
    );
    if (!canvas || stores.length !== 1)
      throw new Error('Room native click observation unavailable');
    const store = stores[0];
    const state = store.getState();
    const objects: {
      object: import('three').Object3D;
      matrix: number[];
      visible: boolean;
      parent: import('three').Object3D | null;
      children: import('three').Object3D[];
    }[] = [];
    state.scene.traverse((object) => {
      if (objects.length >= 5000)
        throw new Error('Room native click object bound');
      objects.push({
        object,
        matrix: [...object.matrixWorld.elements],
        visible: object.visible,
        parent: object.parent,
        children: [...object.children],
      });
    });
    const events: NativeRoomClickPhase[] = [];
    const types = [
      'pointerdown',
      'pointerup',
      'click',
      'pointercancel',
    ] as const;
    const frame = (rect: DOMRect): Frame => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
    const stop = () => {
      for (const type of types)
        document.removeEventListener(type, receive, true);
    };
    const receive = (event: Event) => {
      if (
        !(event instanceof MouseEvent) ||
        !event.isTrusted ||
        (event.type !== 'pointercancel' && event.button !== 0)
      )
        return;
      if (events.length >= 4) return;
      const target = event.target instanceof Element ? event.target : null;
      const live = store.getState() as RootState;
      const viewer = canvas.closest('[data-testid="room-viewer"]');
      const more = viewer?.querySelector('[aria-label="More map controls"]');
      const panel = viewer?.querySelector<HTMLElement>(
        '[role="region"][aria-label="More map controls"]',
      );
      const placement = panel?.dataset.placement;
      const targetCode = target
        ?.closest('[data-location-code]')
        ?.getAttribute('data-location-code');
      events.push({
        phase: event.type as NativeRoomClickPhase['phase'],
        trusted: event.isTrusted,
        target:
          target === canvas
            ? 'canvas'
            : target?.closest('[data-location-code]')
              ? 'room-label'
              : target?.closest(
                    '[role="toolbar"], [role="region"][aria-label="More map controls"]',
                  )
                ? 'room-control'
                : 'other',
        targetLocationCode:
          targetCode &&
          /^ITC-(?:S[1-4][ABC]|D(?:0[1-9]|1[0-2])|RED|BLACK|CLEAR|RACK|L|R)$/.test(
            targetCode,
          )
            ? targetCode
            : null,
        client: { x: event.clientX, y: event.clientY },
        offset: { x: event.offsetX, y: event.offsetY },
        frame: frame(canvas.getBoundingClientRect()),
        size: { width: live.size.width, height: live.size.height },
        view: [...live.camera.matrixWorldInverse.elements],
        projection: [...live.camera.projectionMatrix.elements],
        worldTransformsUnchanged: objects.every(
          ({ object, matrix, visible, parent, children }) =>
            live.scene === state.scene &&
            object.parent === parent &&
            object.children.length === children.length &&
            object.children.every(
              (child, index) => child === children[index],
            ) &&
            object.visible === visible &&
            object.matrixWorld.elements.every(
              (value, index) => value === matrix[index],
            ),
        ),
        moreExpanded: more?.getAttribute('aria-expanded') === 'true',
        panel: {
          placement: !panel
            ? 'closed'
            : placement === 'above' ||
                placement === 'below' ||
                placement === 'inline'
              ? placement
              : 'other',
          frame: panel ? frame(panel.getBoundingClientRect()) : null,
        },
      });
      if (
        event.type === 'click' ||
        event.type === 'pointercancel' ||
        events.length === 4
      )
        stop();
    };
    for (const type of types)
      document.addEventListener(type, receive, {
        capture: true,
        passive: true,
      });
    return { read: () => events, stop };
  });
}

export async function finishNativeRoomClick(
  observation: JSHandle<Capture>,
  click: RoomClickWitness,
) {
  try {
    const phases = await observation.evaluate((capture) => {
      capture.stop();
      return capture.read();
    });
    return {
      requested: click,
      phases: projectNativeClickPhases(phases),
    };
  } finally {
    await observation.dispose();
  }
}
