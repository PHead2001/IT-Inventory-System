/** DOM-only bridge: owners are revocable sessions, never inventory identities. */
type OwnerEntries = Map<HTMLElement, object>;
type Registry = {
  owners: Set<OwnerEntries>;
  listeners: Set<() => void>;
};
const registries = new WeakMap<Document, Registry>();
function registryFor(document: Document) {
  let registry = registries.get(document);
  if (!registry) {
    registry = { owners: new Set(), listeners: new Set() };
    registries.set(document, registry);
  }
  return registry;
}
export type RoomObstructionRegistration = {
  change: () => void;
  dispose: () => void;
};
export function createRoomObstructionOwner(document: Document) {
  const registry = registryFor(document);
  const elements: OwnerEntries = new Map();
  let active = true;
  const notify = () => registry.listeners.forEach((listener) => listener());
  const observer = new ResizeObserver(() => {
    if (active) notify();
  });
  registry.owners.add(elements);
  return {
    register(element: HTMLElement): RoomObstructionRegistration {
      if (!active || element.ownerDocument !== document)
        return { change() {}, dispose() {} };
      const token = {};
      elements.set(element, token);
      observer.observe(element);
      notify();
      const current = () => active && elements.get(element) === token;
      return {
        change() {
          if (current()) notify();
        },
        dispose() {
          if (!current()) return;
          elements.delete(element);
          observer.unobserve(element);
          notify();
        },
      };
    },
    retire() {
      if (!active) return;
      active = false;
      observer.disconnect();
      elements.clear();
      registry.owners.delete(elements);
      notify();
    },
  };
}

/** Subscribe only while the canvas is connected; no idle work or DOM observer. */
export function connectRoomObstructions(
  canvas: HTMLCanvasElement,
  changed: () => void,
  subscribeViewport = true,
) {
  const document = canvas.ownerDocument;
  const registry = registryFor(document);
  const view = document.defaultView;
  let active = true;
  const notify = () => {
    if (active) changed();
  };
  registry.listeners.add(notify);
  if (subscribeViewport) {
    view?.addEventListener('resize', notify);
    view?.addEventListener('scroll', notify, true);
    view?.visualViewport?.addEventListener('resize', notify);
    view?.visualViewport?.addEventListener('scroll', notify);
  }
  return () => {
    active = false;
    registry.listeners.delete(notify);
    if (subscribeViewport) {
      view?.removeEventListener('resize', notify);
      view?.removeEventListener('scroll', notify, true);
      view?.visualViewport?.removeEventListener('resize', notify);
      view?.visualViewport?.removeEventListener('scroll', notify);
    }
  };
}

/** CSS-pixel rectangles of painted cards and this surface's local controls. */
export function collectRoomObstructionRects(
  canvas: HTMLCanvasElement,
  viewport?: DOMRect,
  beforeMeasure?: () => boolean | void,
) {
  if (!canvas.isConnected) return [];
  // The optional viewport read is budgeted too; runtime callers provide their
  // already measured snapshot so obstruction collection cannot reread it.
  if (!viewport) {
    if (beforeMeasure?.() === false) return [];
    viewport = canvas.getBoundingClientRect();
  }
  if (viewport.right <= viewport.left || viewport.bottom <= viewport.top)
    return [];
  const surface = canvas.closest('[data-room-surface]');
  const elements = new Set<HTMLElement>();
  for (const element of surface?.querySelectorAll<HTMLElement>(
    '[data-room-obstruction]',
  ) ?? []) {
    if (element.closest('[data-room-surface]') === surface)
      elements.add(element);
  }
  for (const owner of registryFor(canvas.ownerDocument).owners)
    for (const element of owner.keys()) {
      const localSurface = element.closest('[data-room-surface]');
      if (!localSurface || localSurface === surface) elements.add(element);
    }
  const rects: DOMRect[] = [];
  for (const element of elements) {
    if (!element.isConnected) continue;
    if (beforeMeasure?.() === false) return rects;
    if (element.getClientRects().length === 0) continue;
    let painted = true;
    for (
      let ancestor: HTMLElement | null = element;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (beforeMeasure?.() === false) return rects;
      const style =
        element.ownerDocument.defaultView?.getComputedStyle(ancestor);
      if (
        ancestor.hidden ||
        style?.display === 'none' ||
        style?.visibility === 'hidden' ||
        style?.visibility === 'collapse' ||
        style?.opacity === '0'
      ) {
        painted = false;
        break;
      }
    }
    if (!painted) continue;
    if (beforeMeasure?.() === false) return rects;
    const rect = element.getBoundingClientRect();
    if (
      [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.left < viewport.right &&
      rect.right > viewport.left &&
      rect.top < viewport.bottom &&
      rect.bottom > viewport.top
    )
      rects.push(rect);
  }
  return rects;
}
