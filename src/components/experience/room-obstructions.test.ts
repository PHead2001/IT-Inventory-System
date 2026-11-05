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

it('stops before any further client, style or bounding read when the current budget refuses work', () => {
  const { surface, canvas } = room();
  const first = card(surface);
  const second = card(surface);
  let ancestors = 0;
  for (
    let node: HTMLElement | null = first.element;
    node;
    node = node.parentElement
  )
    ancestors++;
  const firstCost = ancestors + 2; // client rects, every ancestor style, bounds
  let remaining = firstCost;
  const charge = vi.fn(() => remaining-- > 0);
  expect(collectRoomObstructionRects(canvas, viewport, charge)).toEqual([
    viewport,
  ]);
  expect(first.measure).toHaveBeenCalledOnce();
  expect(second.element.getClientRects).not.toHaveBeenCalled();
  expect(second.measure).not.toHaveBeenCalled();
  expect(charge).toHaveBeenCalledTimes(firstCost + 1);
});

it('performs no viewport, candidate or style layout reads when the budget is zero', () => {
  const { surface, canvas } = room();
  const value = card(surface);
  const style = vi.spyOn(window, 'getComputedStyle');
  expect(collectRoomObstructionRects(canvas, undefined, () => false)).toEqual(
    [],
  );
  expect(canvas.getBoundingClientRect).not.toHaveBeenCalled();
  expect(value.element.getClientRects).not.toHaveBeenCalled();
  expect(value.measure).not.toHaveBeenCalled();
  expect(style).not.toHaveBeenCalled();
  expect(collectRoomObstructionRects(canvas, viewport, () => false)).toEqual(
    [],
  );
  expect(value.element.getClientRects).not.toHaveBeenCalled();
  expect(style).not.toHaveBeenCalled();
});

it('charges zero-rectangle hidden candidates and stops before reading the next one', () => {
  const { surface, canvas } = room();
  const first = card(surface);
  const second = card(surface);
  vi.mocked(first.element.getClientRects).mockReturnValue(
    [] as unknown as DOMRectList,
  );
  const style = vi.spyOn(window, 'getComputedStyle');
  const charge = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  expect(collectRoomObstructionRects(canvas, viewport, charge)).toEqual([]);
  expect(first.element.getClientRects).toHaveBeenCalledOnce();
  expect(second.element.getClientRects).not.toHaveBeenCalled();
  expect(first.measure).not.toHaveBeenCalled();
  expect(second.measure).not.toHaveBeenCalled();
  expect(style).not.toHaveBeenCalled();
});

it('charges a style-hidden candidate before rejecting it and does not read another candidate after refusal', () => {
  const { surface, canvas } = room();
  const hidden = card(surface);
  const next = card(surface);
  hidden.element.style.visibility = 'hidden';
  const style = vi.spyOn(window, 'getComputedStyle');
  let remaining = 2; // client rects and the hidden leaf style
  expect(
    collectRoomObstructionRects(canvas, viewport, () => remaining-- > 0),
  ).toEqual([]);
  expect(hidden.element.getClientRects).toHaveBeenCalledOnce();
  expect(style.mock.calls.map(([element]) => element)).toEqual([
    hidden.element,
  ]);
  expect(hidden.measure).not.toHaveBeenCalled();
  expect(next.element.getClientRects).not.toHaveBeenCalled();
  expect(next.measure).not.toHaveBeenCalled();
});

it('charges each ancestor of a deeply nested candidate and ends collection immediately on refusal', () => {
  const { surface, canvas } = room();
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  surface.append(outer);
  outer.append(inner);
  const deep = card(inner);
  const next = card(surface);
  const style = vi.spyOn(window, 'getComputedStyle');
  let remaining = 3; // client rects, leaf style, inner style
  const charge = vi.fn(() => remaining-- > 0);
  expect(collectRoomObstructionRects(canvas, viewport, charge)).toEqual([]);
  expect(deep.element.getClientRects).toHaveBeenCalledOnce();
  expect(style.mock.calls.map(([element]) => element)).toEqual([
    deep.element,
    inner,
  ]);
  expect(deep.measure).not.toHaveBeenCalled();
  expect(next.element.getClientRects).not.toHaveBeenCalled();
  expect(next.measure).not.toHaveBeenCalled();
});

it('opts out of all viewport listeners while retaining card notifications and silencing cleanup', () => {
  const visual = new EventTarget();
  vi.stubGlobal('visualViewport', visual);
  const { surface, canvas } = room();
  const changed = vi.fn();
  const disconnect = connectRoomObstructions(canvas, changed, false);
  cleanups.push(disconnect);
  const viewportEvents = () => {
    window.dispatchEvent(new Event('resize'));
    surface.dispatchEvent(new Event('scroll', { bubbles: false }));
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
  };
  viewportEvents();
  expect(changed).not.toHaveBeenCalled();
  const session = owner();
  const handle = session.register(card(document.body).element);
  expect(changed).toHaveBeenCalledTimes(1);
  handle.change();
  expect(changed).toHaveBeenCalledTimes(2);
  observers[0].callback([], {} as ResizeObserver);
  expect(changed).toHaveBeenCalledTimes(3);
  handle.dispose();
  expect(changed).toHaveBeenCalledTimes(4);
  session.register(card(document.body).element);
  expect(changed).toHaveBeenCalledTimes(5);
  session.retire();
  expect(changed).toHaveBeenCalledTimes(6);
  disconnect();
  changed.mockClear();
  const replacement = owner();
  const next = replacement.register(card(document.body).element);
  next.change();
  observers[1].callback([], {} as ResizeObserver);
  next.dispose();
  replacement.retire();
  viewportEvents();
  expect(changed).not.toHaveBeenCalled();
});
