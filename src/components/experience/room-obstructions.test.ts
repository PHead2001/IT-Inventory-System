import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  collectRoomObstructionRects,
  connectRoomObstructions,
  createRoomObstructionOwner,
} from './room-obstructions';

const viewport = new DOMRect(0, 0, 200, 200);
const cleanups: (() => void)[] = [];
let observers: {
  callback: ResizeObserverCallback;
  disconnect: ReturnType<typeof vi.fn>;
}[];
beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    },
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function room(parent: HTMLElement = document.body) {
  const surface = document.createElement('div');
  surface.dataset.roomSurface = 'true';
  const canvas = document.createElement('canvas');
  surface.append(canvas);
  parent.append(surface);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(viewport);
  return { surface, canvas };
}
function card(parent: HTMLElement, rect = viewport) {
  const element = document.createElement('div');
  element.dataset.roomObstruction = 'true';
  parent.append(element);
  vi.spyOn(element, 'getClientRects').mockReturnValue([
    rect,
  ] as unknown as DOMRectList);
  const measure = vi
    .spyOn(element, 'getBoundingClientRect')
    .mockReturnValue(rect);
  return { element, measure };
}
function owner() {
  const value = createRoomObstructionOwner(document);
  cleanups.push(value.retire);
  return value;
}
it('unions cards with own local controls, deduplicates identity and excludes nested/foreign rooms', () => {
  const first = room();
  const nested = room(first.surface);
  const second = room();
  const local = card(first.surface);
  const foreign = card(nested.surface);
  const global = card(document.body, new DOMRect(150, 0, 50, 50));
  const session = owner();
  session.register(local.element);
  session.register(foreign.element);
  session.register(global.element);
  expect(collectRoomObstructionRects(first.canvas)).toHaveLength(2);
  expect(collectRoomObstructionRects(second.canvas)).toEqual([
    global.measure(),
  ]);
  expect(collectRoomObstructionRects(nested.canvas)).toHaveLength(2);
});
it('reserves cards individually so gaps and nonoverlapping canvases stay usable', () => {
  const { canvas } = room();
  const stack = document.createElement('aside');
  document.body.append(stack);
  const upper = card(stack, new DOMRect(0, 0, 200, 30));
  const lower = card(stack, new DOMRect(0, 170, 200, 30));
  const outside = card(stack, new DOMRect(220, 0, 30, 30));
  const session = owner();
  [upper, lower, outside].forEach(({ element }) => session.register(element));
  expect(collectRoomObstructionRects(canvas)).toEqual([
    upper.measure(),
    lower.measure(),
  ]);
});
it('rejects disconnected, invisible, empty and offscreen nodes but includes painted inert exit shells', () => {
  const { canvas } = room();
  const session = owner();
  const exit = card(document.body);
  exit.element.inert = true;
  exit.element.setAttribute('aria-hidden', 'true');
  session.register(exit.element);
  for (const reason of [
    'removed',
    'display',
    'visibility',
    'opacity',
    'empty',
    'offscreen',
    'no-client-rects',
  ]) {
    const wrapper = document.createElement('div');
    document.body.append(wrapper);
    const value = card(wrapper);
    session.register(value.element);
    if (reason === 'removed') value.element.remove();
    if (reason === 'display') wrapper.style.display = 'none';
    if (reason === 'visibility') wrapper.style.visibility = 'hidden';
    if (reason === 'opacity') wrapper.style.opacity = '0';
    if (reason === 'empty')
      value.measure.mockReturnValue(new DOMRect(0, 0, 0, 20));
    if (reason === 'offscreen')
      value.measure.mockReturnValue(new DOMRect(201, 0, 20, 20));
    if (reason === 'no-client-rects')
      vi.mocked(value.element.getClientRects).mockReturnValue(
        [] as unknown as DOMRectList,
      );
  }
  expect(collectRoomObstructionRects(canvas)).toEqual([exit.measure()]);
});
it('retires generations synchronously and late callbacks cannot change a replacement owner or element registration', () => {
  const { canvas } = room();
  const changed = vi.fn();
  cleanups.push(connectRoomObstructions(canvas, changed));
  const element = card(document.body).element;
  const priorOwner = owner();
  const old = priorOwner.register(element);
  const replacement = priorOwner.register(element);
  changed.mockClear();
  old.change();
  old.dispose();
  expect(changed).not.toHaveBeenCalled();
  expect(collectRoomObstructionRects(canvas)).toHaveLength(1);
  replacement.change();
  expect(changed).toHaveBeenCalledOnce();
  priorOwner.retire();
  expect(collectRoomObstructionRects(canvas)).toHaveLength(0);
  const nextOwner = owner();
  nextOwner.register(element);
  changed.mockClear();
  replacement.change();
  replacement.dispose();
  observers[0].callback([], {} as ResizeObserver);
  priorOwner.register(card(document.body).element);
  expect(changed).not.toHaveBeenCalled();
  expect(collectRoomObstructionRects(canvas)).toHaveLength(1);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
});
it('notifies each connected room for card resize and viewport/captured scroll, then detaches all subscriptions', () => {
  const visual = new EventTarget();
  vi.stubGlobal('visualViewport', visual);
  const first = room();
  const second = room();
  const changed = vi.fn();
  const other = vi.fn();
  const disconnect = connectRoomObstructions(first.canvas, changed);
  const disconnectOther = connectRoomObstructions(second.canvas, other);
  cleanups.push(disconnect, disconnectOther);
  const session = owner();
  const handle = session.register(card(document.body).element);
  changed.mockClear();
  other.mockClear();
  observers[0].callback([], {} as ResizeObserver);
  first.surface.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  visual.dispatchEvent(new Event('scroll'));
  visual.dispatchEvent(new Event('resize'));
  expect(changed).toHaveBeenCalledTimes(5);
  expect(other).toHaveBeenCalledTimes(5);
  disconnect();
  changed.mockClear();
  handle.change();
  window.dispatchEvent(new Event('resize'));
  visual.dispatchEvent(new Event('scroll'));
  expect(changed).not.toHaveBeenCalled();
  expect(other).toHaveBeenCalledTimes(8);
});
it('does not share external owners between documents', () => {
  const { canvas } = room();
  const foreignDocument = document.implementation.createHTMLDocument();
  const foreign = foreignDocument.createElement('div');
  foreignDocument.body.append(foreign);
  vi.spyOn(foreign, 'getClientRects').mockReturnValue([
    viewport,
  ] as unknown as DOMRectList);
  vi.spyOn(foreign, 'getBoundingClientRect').mockReturnValue(viewport);
  const session = createRoomObstructionOwner(foreignDocument);
  cleanups.push(session.retire);
  session.register(foreign);
  expect(collectRoomObstructionRects(canvas)).toHaveLength(0);
});

it('stops collecting before another measurement when the current packing budget refuses work', () => {
  const { surface, canvas } = room();
  const first = card(surface);
  const second = card(surface);
  const charge = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  expect(collectRoomObstructionRects(canvas, viewport, charge)).toEqual([viewport]);
  expect(first.measure).toHaveBeenCalledOnce();
  expect(second.measure).not.toHaveBeenCalled();
  expect(charge).toHaveBeenCalledTimes(2);
});
