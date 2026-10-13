import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  installRoomDrawObservation,
  summarizeRoomDraws,
} from '../e2e/room-draw-observation';

let nextFrame: FrameRequestCallback;
let canvas: HTMLCanvasElement;
const native = vi.fn(function (this: FakeContext, value: number) {
  if (value < 0) throw new Error('native failure');
  return this.canvas;
});
class FakeContext {
  constructor(public canvas: HTMLCanvasElement) {}
  drawArrays(value: number) {
    return native.call(this, value);
  }
  drawElements(value: number) {
    return native.call(this, value);
  }
  drawArraysInstanced(value: number) {
    return native.call(this, value);
  }
  drawElementsInstanced(value: number) {
    return native.call(this, value);
  }
}
const original = FakeContext.prototype.drawArrays;
beforeEach(() => {
  vi.stubGlobal('WebGLRenderingContext', FakeContext);
  vi.stubGlobal('WebGL2RenderingContext', undefined);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    nextFrame = callback;
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  const surface = document.createElement('div');
  surface.dataset.roomSurface = 'true';
  canvas = document.createElement('canvas');
  canvas.dataset.spatialPhase = 'flying';
  surface.append(canvas);
  document.body.append(surface);
  installRoomDrawObservation();
});
afterEach(() => {
  window.__roomDrawObservation?.stop();
  delete window.__roomDrawObservation;
  FakeContext.prototype.drawArrays = original;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
it.each([
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
] as const)(
  'preserves %s receiver, arguments, return and exceptions while counting actual room draws',
  (method) => {
    const context = new FakeContext(canvas);
    expect(context[method](3)).toBe(canvas);
    expect(native).toHaveBeenCalledWith(3);
    expect(native.mock.contexts.at(-1)).toBe(context);
    expect(() => context[method](-1)).toThrow('native failure');
    new FakeContext(document.createElement('canvas'))[method](4);
    const evidence = window.__roomDrawObservation!.snapshot();
    expect(evidence.installed).toBe(4);
    expect(evidence.frames).toHaveLength(1);
    expect(evidence.frames[0]).toMatchObject({
      draws: 1,
      phase: 'flying',
      captureMs: null,
    });
    evidence.frames[0].draws = 100;
    expect(window.__roomDrawObservation!.snapshot().frames[0].draws).toBe(1);
  },
);
it('reports observation failure and restores methods without changing a successful native return', () => {
  vi.spyOn(canvas, 'closest').mockImplementation(() => {
    throw new Error('observation failure');
  });
  expect(new FakeContext(canvas).drawArrays(1)).toBe(canvas);
  expect(window.__roomDrawObservation!.snapshot().overflow).toBe(true);
  expect(FakeContext.prototype.drawArrays).toBe(original);
});
it('omits actor/backend scope from persisted request observations', () => {
  canvas.dataset.spatialRequest = JSON.stringify({
    scope: 'private-actor|private-backend',
    requestId: 3,
    generation: 2,
    code: 'ITC-RED',
  });
  new FakeContext(canvas).drawArrays(1);
  expect(window.__roomDrawObservation!.snapshot().frames[0].request).toBe(
    '{"requestId":3,"generation":2,"code":"ITC-RED"}',
  );
});
it('records no frames for idle animation callbacks and separates draw-bearing frames', () => {
  nextFrame(0);
  nextFrame(16);
  expect(window.__roomDrawObservation!.snapshot().frames).toEqual([]);
  const context = new FakeContext(canvas);
  context.drawArrays(1);
  context.drawArrays(2);
  nextFrame(32);
  context.drawArrays(1);
  expect(
    window.__roomDrawObservation!.snapshot().frames.map((frame) => frame.draws),
  ).toEqual([2, 1]);
  window.__roomDrawObservation!.reset();
  expect(window.__roomDrawObservation!.snapshot().frames).toEqual([]);
});
it('restores its descriptor and never overwrites a later observer owner', () => {
  window.__roomDrawObservation!.stop();
  expect(FakeContext.prototype.drawArrays).toBe(original);
  installRoomDrawObservation();
  const newer = vi.fn(original);
  FakeContext.prototype.drawArrays = newer;
  window.__roomDrawObservation!.stop();
  expect(FakeContext.prototype.drawArrays).toBe(newer);
});
it('caps its buffer, reports overflow and restores native methods', () => {
  const context = new FakeContext(canvas);
  for (let frame = 0; frame < 4097; frame++) {
    context.drawArrays(1);
    nextFrame(frame);
  }
  const evidence = window.__roomDrawObservation!.snapshot();
  expect(evidence.frames).toHaveLength(4096);
  expect(evidence.overflow).toBe(true);
  expect(FakeContext.prototype.drawArrays).toBe(original);
});
it('reports draw intervals and CPU submission separately, with honest empty samples', () => {
  const empty = summarizeRoomDraws({
    frames: [],
    installed: 1,
    overflow: false,
    elapsedMs: 50,
  });
  expect(empty.drawFrameIntervalMs.median).toBeNull();
  const frames = [0, 16, 36].map((firstDrawAt) => ({
    firstDrawAt,
    lastDrawAt: firstDrawAt + 2,
    draws: 3,
    submissionMs: 2,
    phase: 'flying',
    open: '',
    request: '1',
    contactCaptures: 0,
    captureMs: null,
    contactStatus: '',
    bloomStatus: '',
  }));
  const result = summarizeRoomDraws({
    frames,
    installed: 1,
    overflow: false,
    elapsedMs: 50,
  });
  expect(result.draws).toBe(9);
  expect(result.drawFrameIntervalMs).toMatchObject({
    samples: 2,
    median: 18,
    p95: 20,
  });
  expect(result.cpuNativeSubmissionMs.median).toBe(2);
});
