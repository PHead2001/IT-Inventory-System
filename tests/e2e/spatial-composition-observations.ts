import { expect, type Locator, type Page } from '@playwright/test';
import { observeRoomScene } from './room-visibility-witness';

declare global {
  interface Window {
    __spatialContextSamples?: number[];
    __spatialObserveContexts?: boolean;
  }
}

/** Observe installed Fiber/WebGL state; never write a camera, mesh or renderer. */
export async function observeSpatialComposition(page: Page) {
  await observeRoomScene(page);
  await page.addInitScript(() => {
    window.__spatialContextSamples = [];
    window.__spatialObserveContexts = true;
    let frames = 0;
    const deadline = performance.now() + 180_000;
    const sample = () => {
      if (
        !window.__spatialObserveContexts ||
        ++frames > 12_000 ||
        performance.now() > deadline
      )
        return;
      const renderers = new Set(
        [...(window.__roomWitnessStores ?? [])].map(
          (store) => store.getState().gl,
        ),
      );
      window.__spatialContextSamples!.push(
        [...renderers].filter(
          (renderer) => !renderer.getContext().isContextLost(),
        ).length,
      );
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

export async function expectSingleLiveRenderer(page: Page) {
  await expect(page.locator('[data-room-surface] canvas')).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const renderers = new Set(
          [...(window.__roomWitnessStores ?? [])].map(
            (store) => store.getState().gl,
          ),
        );
        return [...renderers].filter(
          (renderer) => !renderer.getContext().isContextLost(),
        ).length;
      }),
    )
    .toBe(1);
}

export async function expectNoRendererOverlap(page: Page) {
  const samples = await page.evaluate(() => {
    window.__spatialObserveContexts = false;
    return window.__spatialContextSamples ?? [];
  });
  expect(
    samples.length,
    'actual live WebGL contexts sampled during handoff',
  ).toBeGreaterThan(0);
  expect(
    Math.max(...samples),
    'including detached contexts awaiting Fiber teardown',
  ).toBe(1);
}

export async function revealPosition(canvas: Locator, nodeId: string) {
  return canvas.evaluate((element, id) => {
    const states = [...(window.__roomWitnessStores ?? [])]
      .map((store) => store.getState())
      .filter((state) => state.gl.domElement === element);
    if (states.length !== 1) throw new Error('Expected one actual Fiber scene');
    const positions: number[][] = [];
    states[0].scene.traverse((object) => {
      if (object.userData.roomRevealNode === id) {
        let meshes = 0;
        object.traverse((child) => {
          if (child.type === 'Mesh' && child.visible) meshes++;
        });
        if (!meshes)
          throw new Error('Reveal body has no actual visible mesh descendants');
        positions.push(object.position.toArray());
      }
    });
    if (positions.length !== 1)
      throw new Error('Expected one rendered reveal body ' + id);
    return positions[0];
  }, nodeId);
}

export async function expectRevealPosition(
  canvas: Locator,
  nodeId: string,
  expected: number[],
) {
  await expect
    .poll(async () => {
      const actual = await revealPosition(canvas, nodeId);
      return Math.max(
        ...actual.map((value, index) => Math.abs(value - expected[index])),
      );
    })
    .toBeLessThan(0.001);
}

/** Await browser registration before advancing a paused clock through real RAFs. */
export async function armSpatialFrames(canvas: Locator, frames: number) {
  if (!Number.isSafeInteger(frames) || frames < 1)
    throw new Error('Expected a positive spatial frame count');
  const capture = await canvas.evaluateHandle((element, limit) => {
    const samples: Array<{
      phase: string | undefined;
      open: string | undefined;
      request: string | undefined;
    }> = [];
    let frame = 0;
    const completed = new Promise<typeof samples>((resolve) => {
      const sample = () => {
        samples.push({
          phase: element.dataset.spatialPhase,
          open: element.dataset.spatialOpenCode,
          request: element.dataset.spatialRequest,
        });
        if (samples.length === limit) resolve(samples);
        else frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    });
    return { completed, cancel: () => cancelAnimationFrame(frame) };
  }, frames);
  return {
    read: () => capture.evaluate((state) => state.completed),
    dispose: async () => {
      try {
        await capture.evaluate((state) => state.cancel());
      } finally {
        await capture.dispose();
      }
    },
  };
}
