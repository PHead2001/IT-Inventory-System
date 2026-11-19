import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachSurfaceEffects, surfaceTargetCurrent } from './surface-effects';

let host: HTMLDivElement;
let card: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let dispose: () => void;
let controller: ReturnType<typeof attachSurfaceEffects>;
let authorized: boolean;
let systemReduced: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let media: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
let sequence = 0;
function pointer(
  target: Element,
  type = 'pointermove',
  x = 30,
  y = 40,
  pointerType = 'mouse',
  extra: Record<string, unknown> = {},
) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, {
    clientX: x,
    clientY: y,
    button: 0,
    pointerType,
    pointerId: 1,
    ...extra,
  });
  target.dispatchEvent(event);
}
function flush() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}

it('keeps coarse Full atmosphere and empty-background touch ripples while excluding spotlight, controls and drags', () => {
  media.matches = false;
  media.addEventListener.mock.calls[0][1]();
  expect(host.dataset.atmosphereActive).toBe('true');
  pointer(card, 'pointermove', 30, 40, 'touch');
  expect(frames.size).toBe(0);
  expect(card.dataset.spotlightActive).toBeUndefined();
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  pointer(host, 'pointerdown', 30, 40, 'touch');
  pointer(host, 'pointermove', 33, 44, 'touch');
  pointer(host, 'pointerup', 33, 44, 'touch');
  expect(animate).toHaveBeenCalledOnce();
  const control = document.createElement('button');
  host.append(control);
  pointer(control, 'pointerdown', 30, 40, 'touch');
  pointer(control, 'pointerup', 30, 40, 'touch');
  pointer(host, 'pointerdown', 30, 40, 'touch');
  pointer(host, 'pointermove', 40, 40, 'touch');
  pointer(host, 'pointerup', 30, 40, 'touch');
  expect(animate).toHaveBeenCalledOnce();
  systemReduced.matches = true;
  systemReduced.addEventListener.mock.calls[0][1]();
  expect(host.dataset.atmosphereActive).toBe('false');
  pointer(host, 'pointerdown', 30, 40, 'touch');
  pointer(host, 'pointerup', 30, 40, 'touch');
  expect(animate).toHaveBeenCalledOnce();
});
beforeEach(() => {
  frames = new Map();
  media = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  systemReduced = {
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  authorized = true;
  vi.stubGlobal('matchMedia', (query: string) =>
    query.includes('prefers-reduced-motion') ? systemReduced : media,
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  document.documentElement.dataset.motion = 'full';
  host = document.createElement('div');
  host.className = 'experience-app';
  card = document.createElement('div');
  card.className = 'experience-spotlight';
  host.append(card);
  document.body.append(host);
  vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
  } as DOMRect);
  controller = attachSurfaceEffects(
    host,
    (element) => authorized && surfaceTargetCurrent(host, element),
  );
  dispose = controller;
});

it('withdraws synchronously, cancels the frame/ripple and needs fresh pointer after authority recovery', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  pointer(card);
  flush();
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup');
  pointer(card);
  const late = [...frames.values()][0];
  authorized = false;
  controller.withdraw();
  expect(frames.size).toBe(0);
  expect(cancel).toHaveBeenCalledOnce();
  expect(card.style.getPropertyValue('--x')).toBe('');
  expect(host.dataset.atmosphereActive).toBe('false');
  late(0);
  expect(card.dataset.spotlightActive).toBeUndefined();
  authorized = true;
  controller.reconcile();
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(0);
  expect(host.dataset.pointerEffectsReady).toBe('false');
  pointer(host, 'pointerup');
  expect(animate).toHaveBeenCalledOnce();
  pointer(card);
  flush();
  expect(card.dataset.spotlightActive).toBe('true');
});

it.each(['hidden', 'inert', 'closed-details', 'detached'])(
  'fences a %s target ancestor before the frame and on mutation without another pointer',
  async (condition) => {
    const parent = document.createElement(
      condition === 'closed-details' ? 'details' : 'div',
    );
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    host.append(parent);
    parent.append(card);
    pointer(card);
    flush();
    pointer(card);
    if (condition === 'closed-details') parent.removeAttribute('open');
    else if (condition === 'detached') parent.remove();
    else parent.setAttribute(condition, '');
    flush();
    expect(card.dataset.spotlightActive).toBeUndefined();
    await Promise.resolve();
    expect(card.style.getPropertyValue('--x')).toBe('');
    if (condition === 'detached') host.append(parent);
    else if (condition === 'closed-details') parent.setAttribute('open', '');
    else parent.removeAttribute(condition);
    await Promise.resolve();
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(card.dataset.spotlightActive).toBeUndefined();
    pointer(card);
    flush();
    expect(card.dataset.spotlightActive).toBe('true');
  },
);

it('does not replay old clicks across target withdrawal or OS reduction', async () => {
  const empty = document.createElement('div');
  empty.dataset.atmosphereBackground = '';
  host.append(empty);
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  pointer(empty, 'pointerdown');
  empty.setAttribute('inert', '');
  await Promise.resolve();
  empty.removeAttribute('inert');
  pointer(empty, 'pointerup');
  expect(animate).not.toHaveBeenCalled();
  pointer(empty, 'pointerdown');
  pointer(empty, 'pointerup');
  empty.hidden = true;
  await Promise.resolve();
  expect(cancel).toHaveBeenCalledOnce();
  pointer(card);
  flush();
  systemReduced.matches = true;
  systemReduced.addEventListener.mock.calls[0][1]();
  expect(card.dataset.spotlightActive).toBeUndefined();
  expect(host.dataset.atmosphereActive).toBe('false');
  systemReduced.matches = false;
  systemReduced.addEventListener.mock.calls[0][1]();
  expect(frames.size).toBe(0);
  expect(card.dataset.spotlightActive).toBeUndefined();
});

it('rejects stale callbacks after disposal and a surface moved outside the host', async () => {
  pointer(card);
  const late = [...frames.values()][0];
  document.body.append(card);
  await Promise.resolve();
  flush();
  expect(card.dataset.spotlightActive).toBeUndefined();
  host.append(card);
  pointer(card);
  dispose();
  late(0);
  expect(card.dataset.spotlightActive).toBeUndefined();
  expect(frames.size).toBe(0);
});

it('allows only the first native summary through every closed details ancestor', async () => {
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.className = 'experience-spotlight';
  summary.textContent = 'Add item';
  const later = document.createElement('summary');
  later.className = 'experience-spotlight';
  details.append(summary, later, card);
  host.append(details);
  vi.spyOn(summary, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 44,
  } as DOMRect);
  pointer(summary);
  flush();
  expect(summary.dataset.spotlightActive).toBe('true');
  pointer(later);
  flush();
  expect(later.dataset.spotlightActive).toBeUndefined();
  pointer(card);
  flush();
  expect(card.dataset.spotlightActive).toBeUndefined();
  const outer = document.createElement('details');
  const outerSummary = document.createElement('summary');
  host.append(outer);
  outer.append(outerSummary, details);
  pointer(summary);
  flush();
  expect(summary.dataset.spotlightActive).toBeUndefined();
  outer.open = true;
  await Promise.resolve();
  for (const fence of ['hidden', 'inert']) {
    summary.setAttribute(fence, '');
    pointer(summary);
    flush();
    expect(summary.dataset.spotlightActive).toBeUndefined();
    summary.removeAttribute(fence);
    await Promise.resolve();
  }
  pointer(summary);
  flush();
  expect(summary.dataset.spotlightActive).toBe('true');
  details.open = true;
  await Promise.resolve();
  expect(summary.dataset.spotlightActive).toBeUndefined();
  details.open = false;
  await Promise.resolve();
  window.dispatchEvent(new Event('resize'));
  flush();
  expect(summary.dataset.spotlightActive).toBeUndefined();
  pointer(summary);
  flush();
  expect(summary.dataset.spotlightActive).toBe('true');
});
afterEach(() => {
  dispose();
  host.remove();
  delete document.documentElement.dataset.motion;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('coalesces pointer writes, caches bounds and refreshes only after invalidation', () => {
  pointer(card, 'pointerover');
  pointer(card);
  pointer(card, 'pointermove', 50, 70);
  expect(frames.size).toBe(1);
  flush();
  expect(card.style.getPropertyValue('--x')).toBe('40px');
  expect(card.style.getPropertyValue('--y')).toBe('50px');
  pointer(card);
  flush();
  expect(card.getBoundingClientRect).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(1);
  flush();
  expect(card.getBoundingClientRect).toHaveBeenCalledTimes(2);
});
it('excludes inputs, dense tables, canvas, touch and coarse pointers', () => {
  for (const tag of ['input', 'textarea', 'select', 'table', 'canvas']) {
    const excluded = document.createElement(tag);
    card.append(excluded);
    pointer(excluded);
    flush();
    expect(card.dataset.spotlightActive).toBeUndefined();
  }
  pointer(card, 'pointermove', 30, 40, 'touch');
  flush();
  expect(card.dataset.spotlightActive).toBeUndefined();
  media.matches = false;
  pointer(card);
  flush();
  expect(card.getBoundingClientRect).not.toHaveBeenCalled();
});
it('clears decoration and pending work on leave, reduced motion, hidden tab and teardown', async () => {
  pointer(card);
  flush();
  pointer(host, 'pointerleave');
  expect(card.style.getPropertyValue('--x')).toBe('');
  pointer(card);
  document.documentElement.dataset.motion = 'reduced';
  await Promise.resolve();
  expect(frames.size).toBe(0);
  document.documentElement.dataset.motion = 'full';
  pointer(card);
  flush();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(card.dataset.spotlightActive).toBeUndefined();
  dispose();
  expect(host.querySelector('.experience-background-ripple')).toBeNull();
});
it('releases a removed surface without another pointer event', async () => {
  pointer(card);
  flush();
  card.remove();
  await Promise.resolve();
  expect(card.dataset.spotlightActive).toBeUndefined();
});
it('allows one bounded empty-background ripple and excludes controls, cards and drags', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  const control = document.createElement('button');
  host.append(control);
  for (const target of [control, card]) {
    pointer(target, 'pointerdown');
    pointer(target, 'pointerup');
  }
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup', 70, 80);
  expect(animate).not.toHaveBeenCalled();
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup');
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup');
  expect(animate).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledOnce();
  expect(host.querySelectorAll('.experience-background-ripple')).toHaveLength(
    1,
  );
});
it('preserves an empty-background click through pointer jitter up to five pixels', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  pointer(host, 'pointerdown', 30, 40);
  pointer(host, 'pointermove', 33, 44);
  pointer(host, 'pointerup', 33, 44);
  expect(animate).toHaveBeenCalledOnce();
});
it('permanently rejects a drag that crosses five pixels and returns before release', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  pointer(host, 'pointerdown', 30, 40);
  pointer(host, 'pointermove', 36, 40);
  pointer(host, 'pointermove', 30, 40);
  pointer(host, 'pointerup', 30, 40);
  expect(animate).not.toHaveBeenCalled();
  pointer(host, 'pointerdown', 30, 40);
  pointer(host, 'pointerup', 30, 40);
  expect(animate).toHaveBeenCalledOnce();
});

it('shares one frame and one bounds read per host for nested spotlight, tilt and magnetic layers', () => {
  card.classList.add('experience-tilt');
  vi.mocked(card.getBoundingClientRect).mockReturnValue({
    left: 10,
    top: 20,
    width: 100,
    height: 100,
  } as DOMRect);
  const action = document.createElement('button');
  action.className = 'experience-magnetic';
  card.append(action);
  const bounds = vi
    .spyOn(action, 'getBoundingClientRect')
    .mockReturnValue({ left: 10, top: 20, width: 50, height: 50 } as DOMRect);
  pointer(action, 'pointermove', 110, 120);
  pointer(action, 'pointermove', 110, 120);
  expect(frames.size).toBe(1);
  flush();
  expect(card.dataset.spotlightActive).toBe('true');
  expect(card.dataset.pointerActive).toBe('true');
  expect(action.dataset.pointerActive).toBe('true');
  const x = Number(action.style.getPropertyValue('--pointer-x'));
  const y = Number(action.style.getPropertyValue('--pointer-y'));
  expect(Math.hypot(x, y)).toBeCloseTo(1);
  expect(card.getBoundingClientRect).toHaveBeenCalledOnce();
  expect(bounds).toHaveBeenCalledOnce();
  pointer(action);
  flush();
  expect(card.getBoundingClientRect).toHaveBeenCalledOnce();
  expect(bounds).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('resize'));
  flush();
  expect(card.getBoundingClientRect).toHaveBeenCalledTimes(2);
  expect(bounds).toHaveBeenCalledTimes(2);
});
it('does not decorate ordinary confirmations and immediately clears a disabled magnetic action', async () => {
  const action = document.createElement('button');
  action.className = 'experience-magnetic';
  host.append(action);
  vi.spyOn(action, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 44,
  } as DOMRect);
  pointer(action);
  flush();
  expect(action.dataset.pointerActive).toBe('true');
  action.disabled = true;
  await Promise.resolve();
  expect(action.dataset.pointerActive).toBeUndefined();
  expect(action.style.getPropertyValue('--pointer-x')).toBe('');
  const confirm = document.createElement('button');
  confirm.textContent = 'Confirm assign';
  host.append(confirm);
  pointer(confirm);
  flush();
  expect(confirm.dataset.pointerActive).toBeUndefined();
});
it('clears every visual layer on touch, motion/media changes, hidden tab and leave', async () => {
  card.classList.add('experience-tilt');
  vi.mocked(card.getBoundingClientRect).mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  pointer(card);
  flush();
  expect(card.dataset.pointerActive).toBe('true');
  pointer(card, 'pointermove', 30, 40, 'touch');
  expect(card.dataset.pointerActive).toBeUndefined();
  expect(host.dataset.pointerEffectsReady).toBe('false');
  pointer(card);
  flush();
  pointer(host, 'pointerleave');
  expect(card.style.getPropertyValue('--pointer-x')).toBe('');
  pointer(card);
  flush();
  media.matches = false;
  media.addEventListener.mock.calls[0][1]();
  expect(card.dataset.pointerActive).toBeUndefined();
  media.matches = true;
  pointer(card);
  flush();
  document.documentElement.dataset.motion = 'reduced';
  await Promise.resolve();
  expect(card.dataset.pointerActive).toBeUndefined();
  document.documentElement.dataset.motion = 'full';
  pointer(card);
  flush();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(card.dataset.pointerActive).toBeUndefined();
  expect(host.dataset.pointerEffectsReady).toBe('false');
});

it('caps magnetic displacement and combined tilt radially at edges and neutralizes zero geometry', () => {
  card.classList.add('experience-magnetic', 'experience-tilt');
  vi.mocked(card.getBoundingClientRect).mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  for (const [x, y] of [
    [0, 0],
    [100, 100],
    [-100, 200],
    [50, 50],
  ]) {
    pointer(card, 'pointermove', x, y);
    flush();
    const horizontal = Number(card.style.getPropertyValue('--pointer-x'));
    const vertical = Number(card.style.getPropertyValue('--pointer-y'));
    expect(Math.hypot(horizontal, vertical)).toBeLessThanOrEqual(1);
    expect(Math.hypot(horizontal * 4, vertical * 4)).toBeLessThanOrEqual(4);
    expect(Math.hypot(horizontal * 6, vertical * 6)).toBeLessThanOrEqual(6);
    expect(card.style.transform).toBe('');
  }
  vi.mocked(card.getBoundingClientRect).mockReturnValue({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  } as DOMRect);
  window.dispatchEvent(new Event('resize'));
  flush();
  expect(card.style.getPropertyValue('--pointer-x')).toBe('0');
  expect(card.style.getPropertyValue('--pointer-y')).toBe('0');
});

it('withdraws queued magnetic and tilt writes under current authority loss, with no replay on reconciliation', () => {
  card.classList.add('experience-magnetic', 'experience-tilt');
  pointer(card);
  flush();
  pointer(card);
  const late = [...frames.values()][0];
  authorized = false;
  controller.withdraw();
  late(0);
  expect(card.dataset.pointerActive).toBeUndefined();
  expect(card.style.getPropertyValue('--pointer-x')).toBe('');
  expect(card.style.getPropertyValue('--pointer-y')).toBe('');
  authorized = true;
  controller.reconcile();
  window.dispatchEvent(new Event('resize'));
  flush();
  expect(card.dataset.pointerActive).toBeUndefined();
  pointer(card);
  flush();
  expect(card.dataset.pointerActive).toBe('true');
});

it('clears an active spotlight immediately when the fine-pointer media changes', () => {
  pointer(card);
  flush();
  expect(card.dataset.spotlightActive).toBe('true');
  pointer(card);
  media.matches = false;
  media.addEventListener.mock.calls[0][1]();
  expect(frames.size).toBe(0);
  expect(card.dataset.spotlightActive).toBeUndefined();
  expect(card.style.getPropertyValue('--x')).toBe('');
});

it('decorates only the nearest eligible nested surface without moving focus or targets', () => {
  const inner = document.createElement('div');
  inner.className = 'experience-spotlight';
  card.append(inner);
  vi.spyOn(inner, 'getBoundingClientRect').mockReturnValue({
    left: 20,
    top: 25,
  } as DOMRect);
  const action = document.createElement('button');
  inner.append(action);
  action.focus();
  pointer(action);
  flush();
  expect(inner.dataset.spotlightActive).toBe('true');
  expect(card.dataset.spotlightActive).toBeUndefined();
  expect(document.activeElement).toBe(action);
  expect(inner.style.transform).toBe('');
  expect(action.style.transform).toBe('');
});

it('rejects controls even when an empty-background marker is mistakenly placed on them', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  for (const tag of ['button', 'a', 'input', 'canvas', 'table']) {
    const control = document.createElement(tag);
    control.setAttribute('data-atmosphere-background', '');
    host.append(control);
    pointer(control, 'pointerdown');
    pointer(control, 'pointerup');
  }
  expect(animate).not.toHaveBeenCalled();
});

it('requires the same primary pointer and primary release, and cancels its animation on hide', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  Object.defineProperty(
    host.querySelector('.experience-background-ripple'),
    'animate',
    { value: animate },
  );
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup', 30, 40, 'mouse', { pointerId: 2 });
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup', 30, 40, 'mouse', { button: 2 });
  pointer(host, 'pointerdown', 30, 40, 'mouse', { isPrimary: false });
  pointer(host, 'pointerup');
  expect(animate).not.toHaveBeenCalled();
  pointer(host, 'pointerdown');
  pointer(host, 'pointerup');
  expect(animate).toHaveBeenCalledOnce();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(cancel).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
});
