import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  bindRouteSnapshotPending,
  bindPrivateSnapshotEligibility,
  privateSnapshotEligible,
  cancelThemeSnapshot,
} from './native-transition-owner';
import { cancelRouteSnapshots } from './route-motion-state';
import { createThemeStore } from './theme-store';
import {
  mediaHolePath,
  revealTheme,
  themeCircle,
  themeRegions,
  collectThemeGeometry,
} from './theme-transition';
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function geometryFrames() {
  let sequence = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++sequence;
    pending.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => pending.delete(id));
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  return {
    pending,
    request,
    cancel,
    advance: () => {
      const frame = pending.entries().next().value;
      if (!frame) throw new Error('No active geometry frame');
      pending.delete(frame[0]);
      frame[1](performance.now());
      return frame[1];
    },
  };
}
let frames: ReturnType<typeof geometryFrames>;
let withdrawGrant: () => void;
function native() {
  const jobs: {
    update: () => void;
    ready: ReturnType<typeof deferred>;
    updated: ReturnType<typeof deferred>;
    finished: ReturnType<typeof deferred>;
    skipTransition: ReturnType<typeof vi.fn>;
  }[] = [];
  const start = vi.fn((update: () => void) => {
    const job = {
      update,
      ready: deferred(),
      updated: deferred(),
      finished: deferred(),
      skipTransition: vi.fn(),
    };
    jobs.push(job);
    return {
      ready: job.ready.promise,
      updateCallbackDone: job.updated.promise,
      finished: job.finished.promise,
      skipTransition: job.skipTransition,
    };
  });
  vi.stubGlobal('CSS', { supports: () => true });
  vi.spyOn(document, 'startViewTransition').mockImplementation(
    start as unknown as typeof document.startViewTransition,
  );
  const animate = vi.fn(
    (_frames: Keyframe[], options: KeyframeAnimationOptions) =>
      ({
        effect: { pseudoElement: options.pseudoElement },
        cancel: vi.fn(),
      }) as unknown as Animation,
  );
  Object.defineProperty(document.documentElement, 'animate', {
    configurable: true,
    value: animate,
  });
  return { jobs, start, animate };
}
beforeEach(() => {
  withdrawGrant = bindPrivateSnapshotEligibility(() => true);
  frames = geometryFrames();
  localStorage.clear();
  document.body.innerHTML =
    '<header><button>Theme</button></header><main><section><canvas></canvas><p>Contents</p></section></main>';
  document.documentElement.dataset.motion = 'full';
  Object.defineProperty(document, 'hidden', {
    value: false,
    configurable: true,
  });
  Object.defineProperty(document, 'startViewTransition', {
    value: () => {},
    configurable: true,
  });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => {
  cancelThemeSnapshot();
  withdrawGrant();
  expect(frames.pending.size).toBe(0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.inventoryTheme;
  vi.useRealTimers();
});
it('uses the control center and farthest visual viewport corner, excluding every media ancestor', () => {
  expect(
    themeCircle(
      { left: 20, top: 30, width: 40, height: 20 },
      { left: 10, top: 20, width: 100, height: 80 },
    ),
  ).toEqual({ x: 40, y: 40, radius: Math.hypot(70, 60) });
  const regions = themeRegions(document.body);
  expect(regions.map((node) => node.tagName)).toEqual(['HEADER', 'P']);
  expect(
    regions.every(
      (node) =>
        !node.querySelector('canvas,video') && !node.matches('canvas,video'),
    ),
  ).toBe(true);
  expect(
    mediaHolePath(100, 80, [{ left: 10, top: 20, width: 30, height: 40 }]),
  ).toBe('path(evenodd, "M0 0h100v80h-100ZM10 20h30v40h-30Z")');
  expect(
    mediaHolePath(100, 80, [
      { left: 10, top: 10, width: 30, height: 30 },
      { left: 20, top: 20, width: 30, height: 30 },
    ]),
  ).toBe(
    'path(evenodd, "M0 0h100v80h-100ZM10 10h10v30h-10ZM20 10h20v40h-20ZM40 20h10v30h-10Z")',
  );
});
it('owns the actual native handle, animates only new disjoint snapshots for 450ms and never remounts media', async () => {
  const { jobs, animate } = native();
  const canvas = document.querySelector('canvas');
  const apply = vi.fn();
  revealTheme({
    apply,
    changed: true,
    automatic: false,
    control: document.querySelector('button')!,
  });
  expect(document.querySelector('canvas')).toBe(canvas);
  expect(canvas?.closest('[data-theme-region]')).toBeNull();
  expect(
    document
      .querySelector('.experience-theme-background')
      ?.getAttribute('style'),
  ).toContain('evenodd');
  expect(apply).not.toHaveBeenCalled();
  jobs[0].update();
  jobs[0].updated.resolve();
  jobs[0].ready.resolve();
  await Promise.resolve();
  expect(apply).toHaveBeenCalledOnce();
  expect(animate).toHaveBeenCalled();
  for (const [frames, options] of animate.mock.calls) {
    expect(options).toMatchObject({ duration: 450, fill: 'both' });
    expect(options.pseudoElement).toMatch(/^::view-transition-new\(theme-/);
    expect(Object.keys(frames[0])).toEqual(['clipPath']);
  }
  jobs[0].finished.resolve();
  await Promise.resolve();
  expect(document.querySelector('[data-theme-region]')).toBeNull();
  expect(document.querySelector('.experience-theme-background')).toBeNull();
  expect(document.querySelector('canvas')).toBe(canvas);
  expect(frames.pending.size).toBe(0);
});
it.each([
  'media resize',
  'media position',
  'excluded ancestor position',
  'insertion',
  'region position',
] as const)(
  'retires stale snapshot geometry for %s without a window resize',
  async (reason) => {
    const { jobs, animate } = native();
    const canvas = document.querySelector('canvas')!;
    const paragraph = document.querySelector('p')!;
    const ancestor = canvas.parentElement!;
    const mediaRect = { left: 10, top: 20, width: 120, height: 80 };
    const regionRect = { left: 150, top: 20, width: 120, height: 80 };
    let ancestorOffset = 0;
    vi.spyOn(canvas, 'getBoundingClientRect').mockImplementation(
      () =>
        ({ ...mediaRect, left: mediaRect.left + ancestorOffset }) as DOMRect,
    );
    vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(
      () => ({ ...regionRect }) as DOMRect,
    );
    const apply = vi.fn();
    revealTheme({ apply, changed: true, automatic: false });
    jobs[0].update();
    jobs[0].updated.resolve();
    jobs[0].ready.resolve();
    await Promise.resolve();
    expect(animate).toHaveBeenCalled();
    if (reason === 'media resize') mediaRect.width += 20;
    else if (reason === 'media position') mediaRect.left += 20;
    else if (reason === 'excluded ancestor position') {
      ancestor.style.transform = 'translateX(20px)';
      ancestorOffset = 20; // jsdom has no layout; model the moved descendant rect.
    } else if (reason === 'region position') regionRect.top += 20;
    else ancestor.append(document.createElement('video'));
    const retiredCallback = frames.advance();
    expect(jobs[0].skipTransition).toHaveBeenCalledOnce();
    expect(frames.pending.size).toBe(0);
    expect(document.querySelector('.experience-theme-background')).toBeNull();
    expect(document.querySelector('[data-theme-region]')).toBeNull();
    expect(document.querySelector('canvas')).toBe(canvas);
    for (const result of animate.mock.results)
      expect((result.value as Animation).cancel).toHaveBeenCalledOnce();
    retiredCallback(performance.now());
    expect(frames.pending.size).toBe(0);
    jobs[0].finished.resolve();
    await Promise.resolve();
  },
);
it.each([
  'finished',
  'skip',
  'ready rejection',
  'update rejection',
  'finished rejection',
] as const)(
  'checks only during the native lease and cancels the outstanding frame on %s',
  async (reason) => {
    const { jobs } = native();
    expect(frames.pending.size).toBe(0);
    revealTheme({ apply: () => {}, changed: true, automatic: false });
    expect(frames.pending.size).toBe(1);
    const retiredCallback = frames.advance();
    expect(frames.pending.size).toBe(1);
    if (reason === 'finished') jobs[0].finished.resolve();
    else if (reason === 'skip') cancelThemeSnapshot();
    else if (reason === 'ready rejection')
      jobs[0].ready.reject(new Error('Ready failed'));
    else if (reason === 'update rejection')
      jobs[0].updated.reject(new Error('Update failed'));
    else jobs[0].finished.reject(new Error('Finished failed'));
    await Promise.resolve();
    await Promise.resolve();
    expect(frames.cancel).toHaveBeenCalledOnce();
    expect(frames.pending.size).toBe(0);
    const requests = frames.request.mock.calls.length;
    retiredCallback(performance.now());
    expect(frames.request).toHaveBeenCalledTimes(requests);
    expect(frames.pending.size).toBe(0);
    revealTheme({ apply: () => {}, changed: false, automatic: false });
    expect(frames.request).toHaveBeenCalledTimes(requests);
  },
);
it('uses a 180ms OS crossfade, while same appearance and pending navigation apply instantly', async () => {
  const { jobs, start, animate } = native();
  revealTheme({ apply: () => {}, changed: true, automatic: true });
  jobs[0].update();
  jobs[0].updated.resolve();
  jobs[0].ready.resolve();
  await Promise.resolve();
  expect(animate.mock.calls[0]).toEqual([
    [{ opacity: 0 }, { opacity: 1 }],
    expect.objectContaining({ duration: 180 }),
  ]);
  jobs[0].finished.resolve();
  await Promise.resolve();
  const apply = vi.fn();
  revealTheme({ apply, changed: false, automatic: false });
  const unbind = bindRouteSnapshotPending(() => true);
  revealTheme({ apply, changed: true, automatic: false });
  expect(start).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledTimes(2);
  unbind();
});
it('completes the nominal reveal inside the total lease after observed native setup overhead', async () => {
  vi.useFakeTimers();
  const { jobs, animate } = native();
  revealTheme({ apply: () => {}, changed: true, automatic: false });
  vi.advanceTimersByTime(60);
  jobs[0].update();
  jobs[0].updated.resolve();
  jobs[0].ready.resolve();
  await Promise.resolve();
  const duration = Number(animate.mock.calls[0][1].duration);
  // The real native failure had ~59ms capture plus ~96ms effect play readiness.
  vi.advanceTimersByTime(95 + duration - 1);
  expect(jobs[0].skipTransition).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(duration).toBe(450);
  jobs[0].finished.resolve();
  await Promise.resolve();
  expect(document.querySelector('[data-theme-region]')).toBeNull();
  expect(frames.pending.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it('latest intent wins when skipped callbacks and rejected native promises arrive out of order', async () => {
  const { jobs } = native();
  document.documentElement.dataset.themeScope = 'app:backend:one';
  window.eval(readFileSync('public/theme-bootstrap.v1.js', 'utf8'));
  const store = createThemeStore('app:backend:one');
  const dispose = store.mount();
  store.choose('light');
  store.choose('system'); // OS-dark equals committed Dark: cancels the older reveal.
  expect(jobs[0].skipTransition).toHaveBeenCalledOnce();
  jobs[0].update();
  jobs[0].ready.reject(new Error('Skipped'));
  jobs[0].updated.reject(new Error('Old update'));
  jobs[0].finished.reject(new Error('Skipped'));
  await Promise.resolve();
  await Promise.resolve();
  expect(store.snapshot()).toMatchObject({
    preference: 'system',
    theme: 'dark',
  });
  expect(document.documentElement.dataset.theme).toBe('dark');
  dispose();
});
it.each(['resize', 'scroll', 'denial', 'reduced', 'hidden', 'scope'] as const)(
  'cancels %s without permitting a skipped callback to restore stale presentation',
  async (reason) => {
    const { jobs } = native();
    document.documentElement.dataset.themeScope = 'app:backend:one';
    window.eval(readFileSync('public/theme-bootstrap.v1.js', 'utf8'));
    const store = createThemeStore('app:backend:one');
    const dispose = store.mount();
    store.choose('light');
    if (reason === 'scope') store.scope('app:backend:two');
    else if (reason === 'denial') cancelRouteSnapshots();
    else if (reason === 'reduced') {
      document.documentElement.dataset.motion = 'reduced';
      await Promise.resolve();
    } else if (reason === 'hidden') {
      Object.defineProperty(document, 'hidden', {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    } else window.dispatchEvent(new Event(reason));
    expect(jobs[0].skipTransition).toHaveBeenCalledOnce();
    jobs[0].update();
    jobs[0].ready.reject(new Error('Skipped'));
    jobs[0].updated.resolve();
    jobs[0].finished.reject(new Error('Skipped'));
    await Promise.resolve();
    await Promise.resolve();
    expect(store.snapshot().theme).toBe(reason === 'scope' ? 'dark' : 'light');
    expect(document.querySelector('[data-theme-region]')).toBeNull();
    expect(frames.pending.size).toBe(0);
    dispose();
  },
);
it('falls back on native creation/update/ready failure and unsupported pseudo effects', async () => {
  const { jobs, start, animate } = native();
  const apply = vi.fn();
  start.mockImplementationOnce(() => {
    throw new Error('Unavailable');
  });
  revealTheme({ apply, changed: true, automatic: false });
  expect(apply).toHaveBeenCalledOnce();
  revealTheme({ apply, changed: true, automatic: false });
  jobs[0].updated.reject(new Error('Update failed'));
  await Promise.resolve();
  expect(apply).toHaveBeenCalledTimes(2);
  jobs[0].ready.reject(new Error('No snapshot'));
  jobs[0].finished.reject(new Error('Skipped'));
  await Promise.resolve();
  revealTheme({ apply, changed: true, automatic: false });
  animate.mockImplementation(
    () =>
      ({
        effect: { pseudoElement: null },
        cancel: vi.fn(),
      }) as unknown as Animation,
  );
  jobs[1].update();
  jobs[1].updated.resolve();
  jobs[1].ready.resolve();
  await Promise.resolve();
  expect(jobs[1].skipTransition).toHaveBeenCalledOnce();
  jobs[1].finished.resolve();
  await Promise.resolve();
  expect(document.documentElement.dataset.themeTransition).toBeUndefined();
});

it('anonymous revocation retires pending native apply callbacks before cancel, including repeated anonymous resets', async () => {
  const { jobs } = native();
  document.documentElement.dataset.themeScope = 'app:backend:anonymous';
  window.eval(readFileSync('public/theme-bootstrap.v1.js', 'utf8'));
  const store = createThemeStore('app:backend:anonymous');
  const dispose = store.mount();
  for (let index = 0; index < 2; index += 1) {
    store.choose('light', undefined, true);
    store.resetScope('app:backend:anonymous');
    expect(jobs[index].skipTransition).toHaveBeenCalledOnce();
    // The skipped native browser callback and promises can arrive after reset.
    jobs[index].update();
    jobs[index].ready.resolve();
    jobs[index].updated.resolve();
    jobs[index].finished.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.snapshot()).toMatchObject({
      preference: 'dark',
      theme: 'dark',
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
  }
  dispose();
});

it('fails closed without a current private provider, and private disposal cannot become a public grant', () => {
  const { start, jobs } = native();
  const apply = vi.fn();
  withdrawGrant();
  expect(privateSnapshotEligible()).toBe(false);
  revealTheme({ apply, changed: true, automatic: false });
  expect(apply).toHaveBeenCalledOnce();
  expect(start).not.toHaveBeenCalled();
  const denied = bindPrivateSnapshotEligibility(() => false);
  revealTheme({ apply, changed: true, automatic: false });
  expect(start).not.toHaveBeenCalled();
  denied();
  const allowed = bindPrivateSnapshotEligibility(() => true);
  revealTheme({ apply, changed: true, automatic: false });
  expect(start).toHaveBeenCalledOnce();
  allowed();
  expect(jobs[0].skipTransition).toHaveBeenCalledOnce();
  expect(privateSnapshotEligible()).toBe(false);
  jobs[0].update();
  expect(apply).toHaveBeenCalledTimes(3);
  expect(document.querySelector('[data-theme-region]')).toBeNull();
});

it('retires a hung native lease at 650ms, applies intent and cannot replay late callbacks', async () => {
  vi.useFakeTimers();
  const { jobs, animate } = native();
  const apply = vi.fn();
  revealTheme({ apply, changed: true, automatic: false });
  vi.advanceTimersByTime(649);
  expect(jobs[0].skipTransition).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(jobs[0].skipTransition).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledOnce();
  expect(frames.pending.size).toBe(0);
  expect(
    document.querySelector('[data-theme-region],.experience-theme-background'),
  ).toBeNull();
  jobs[0].update();
  jobs[0].ready.resolve();
  jobs[0].updated.resolve();
  jobs[0].finished.resolve();
  await Promise.resolve();
  expect(animate).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['nodes', 'regions', 'media'] as const)(
  'bounds %s discovery before naming or native capture',
  (kind) => {
    const { start } = native();
    const apply = vi.fn();
    document.body.replaceChildren();
    if (kind === 'nodes') {
      const root = document.createElement('main');
      document.body.append(root);
      for (let index = 0; index < 2048; index++)
        root.append(document.createElement('span'));
    } else if (kind === 'media') {
      for (let index = 0; index < 33; index++)
        document.body.append(document.createElement('canvas'));
    } else {
      for (let index = 0; index < 257; index++)
        document.body.append(document.createElement('section'));
    }
    expect(collectThemeGeometry(document.body, false)).toBeNull();
    revealTheme({ apply, changed: true, automatic: false });
    expect(start).not.toHaveBeenCalled();
    expect(apply).toHaveBeenCalledOnce();
    expect(
      document.querySelector(
        '[data-theme-region],.experience-theme-background',
      ),
    ).toBeNull();
    expect(frames.pending.size).toBe(0);
  },
);

it('applies instantly without geometry observers and withdraws a live lease when its strict grant changes', () => {
  const { start, jobs } = native();
  const apply = vi.fn();
  const resizeObserver = globalThis.ResizeObserver;
  vi.stubGlobal('ResizeObserver', undefined);
  revealTheme({ apply, changed: true, automatic: false });
  expect(start).not.toHaveBeenCalled();
  expect(apply).toHaveBeenCalledOnce();
  vi.stubGlobal('ResizeObserver', resizeObserver);
  let ready = true;
  withdrawGrant();
  const dispose = bindPrivateSnapshotEligibility(() => ready);
  revealTheme({ apply, changed: true, automatic: false });
  ready = false;
  frames.advance();
  expect(jobs[0].skipTransition).toHaveBeenCalledOnce();
  expect(frames.pending.size).toBe(0);
  dispose();
});
