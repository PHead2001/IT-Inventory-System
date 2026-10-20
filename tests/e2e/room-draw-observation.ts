/** Browser-only, test-owned observation. No camera/scene writes or extra renders. */
export type RoomDrawFrame = {
  firstDrawAt: number;
  lastDrawAt: number;
  draws: number;
  submissionMs: number;
  phase: string;
  open: string;
  request: string;
  contactCaptures: number;
  captureMs: number | null;
  contactStatus: string;
  bloomStatus: string;
};
export type RoomDrawEvidence = {
  frames: RoomDrawFrame[];
  overflow: boolean;
  installed: number;
  elapsedMs: number;
};
declare global {
  interface Window {
    __roomDrawObservation?: {
      snapshot(): RoomDrawEvidence;
      reset(): void;
      stop(): void;
    };
  }
}

/** Self-contained for Playwright addInitScript serialization. */
export function installRoomDrawObservation() {
  window.__roomDrawObservation?.stop();
  const maxFrames = 4096;
  const maxDrawsPerFrame = 200_000;
  const deadlineMs = 180_000;
  let frames: RoomDrawFrame[] = [];
  let pending: RoomDrawFrame | null = null;
  let overflow = false;
  let running = true;
  let started = performance.now();
  let raf = 0;
  const restores: (() => void)[] = [];
  const finishFrame = () => {
    if (!pending) return;
    if (frames.length < maxFrames) frames.push(pending);
    else overflow = true;
    pending = null;
  };
  const stop = () => {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    finishFrame();
    restores.reverse().forEach((restore) => restore());
  };
  const record = (
    context: WebGLRenderingContext,
    before: number,
    after: number,
  ) => {
    if (!running) return;
    const canvas = context.canvas;
    if (
      !(canvas instanceof HTMLCanvasElement) ||
      !canvas.closest('[data-room-surface]')
    )
      return;
    if (!pending) {
      const rawCapture = canvas.dataset.contactCaptureMs;
      const capture = rawCapture ? Number(rawCapture) : NaN;
      // The app's scope includes actor/backend authority; artifacts need only
      // the numeric request/generation and public logical location code.
      let request = '';
      if (canvas.dataset.spatialRequest) {
        if (canvas.dataset.spatialRequest.length > 2048)
          throw new Error('Request observation bound');
        const token = JSON.parse(canvas.dataset.spatialRequest);
        if (
          !Number.isSafeInteger(token.requestId) ||
          !Number.isSafeInteger(token.generation)
        )
          throw new Error('Request observation shape');
        request = JSON.stringify({
          requestId: token.requestId,
          generation: token.generation,
          code:
            typeof token.code === 'string' &&
            /^[A-Z0-9-]{1,64}$/.test(token.code)
              ? token.code
              : null,
        });
      }
      pending = {
        firstDrawAt: before,
        lastDrawAt: after,
        draws: 0,
        submissionMs: 0,
        phase: (canvas.dataset.spatialPhase ?? '').slice(0, 16),
        open: (canvas.dataset.spatialOpenCode ?? '').slice(0, 64),
        request,
        contactCaptures: Number(canvas.dataset.contactCaptures ?? 0),
        captureMs: Number.isFinite(capture) ? capture : null,
        contactStatus: (canvas.dataset.contactStatus ?? '').slice(0, 64),
        bloomStatus: (canvas.dataset.bloomStatus ?? '').slice(0, 64),
      };
    }
    if (pending.draws >= maxDrawsPerFrame) {
      overflow = true;
      stop();
      return;
    }
    pending.draws++;
    pending.lastDrawAt = after;
    pending.submissionMs += after - before;
  };
  const prototypes = new Set<object>();
  if (typeof WebGLRenderingContext !== 'undefined')
    prototypes.add(WebGLRenderingContext.prototype);
  if (typeof WebGL2RenderingContext !== 'undefined')
    prototypes.add(WebGL2RenderingContext.prototype);
  for (const prototype of prototypes) {
    for (const name of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (
        !descriptor ||
        typeof descriptor.value !== 'function' ||
        !descriptor.configurable
      )
        continue;
      const original = descriptor.value as (...args: unknown[]) => unknown;
      const wrapped = function (
        this: WebGLRenderingContext,
        ...args: unknown[]
      ) {
        const before = performance.now();
        // Preserve native exceptions and count only successfully submitted calls.
        const result = Reflect.apply(original, this, args);
        try {
          record(this, before, performance.now());
        } catch {
          // A failed observation invalidates evidence, never the application draw.
          overflow = true;
          stop();
        }
        return result;
      };
      Object.defineProperty(prototype, name, { ...descriptor, value: wrapped });
      restores.push(() => {
        if (Object.getOwnPropertyDescriptor(prototype, name)?.value === wrapped)
          Object.defineProperty(prototype, name, descriptor);
      });
    }
  }
  const tick = () => {
    finishFrame();
    if (performance.now() - started >= deadlineMs || overflow) {
      overflow = true;
      stop();
      return;
    }
    if (running) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  window.__roomDrawObservation = {
    snapshot: () => ({
      frames: [
        ...frames,
        ...(pending && frames.length < maxFrames ? [pending] : []),
      ].map((frame) => ({ ...frame })),
      overflow: overflow || (!!pending && frames.length >= maxFrames),
      installed: restores.length,
      elapsedMs: performance.now() - started,
    }),
    reset: () => {
      if (!running) throw new Error('Draw observation is stopped');
      frames = [];
      pending = null;
      overflow = false;
      started = performance.now();
    },
    stop,
  };
}

export function summarizeRoomDraws(evidence: RoomDrawEvidence) {
  const intervals = evidence.frames
    .slice(1)
    .map((frame, i) => frame.firstDrawAt - evidence.frames[i].firstDrawAt);
  const stats = (values: number[]) => {
    const sorted = values.toSorted((a, b) => a - b);
    return {
      samples: sorted.length,
      median: sorted.length
        ? (sorted[Math.floor((sorted.length - 1) / 2)] +
            sorted[Math.floor(sorted.length / 2)]) /
          2
        : null,
      p95: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1] : null,
      maximum: sorted.at(-1) ?? null,
    };
  };
  return {
    drawBearingFrames: evidence.frames.length,
    draws: evidence.frames.reduce((sum, frame) => sum + frame.draws, 0),
    drawFrameIntervalMs: stats(intervals),
    cpuNativeSubmissionMs: stats(
      evidence.frames.map((frame) => frame.submissionMs),
    ),
    overflow: evidence.overflow,
  };
}
