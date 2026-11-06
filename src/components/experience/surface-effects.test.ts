import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachSurfaceEffects } from './surface-effects';

let host: HTMLDivElement;
let card: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let dispose: () => void;
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
beforeEach(() => {
  frames = new Map();
  media = {
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', () => media);
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
  dispose = attachSurfaceEffects(host);
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
