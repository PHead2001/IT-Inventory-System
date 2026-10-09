import { describe, expect, it, vi } from 'vitest';
import { attachMapInput } from './map-input';

function pointer(type: string, x: number, y: number, id = 1) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: id });
  return event;
}
describe('map input ownership', () => {
  it.each([false, true])(
    'keeps a completed tap selectable after normal implicit capture release with active=%s',
    (active) => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const gesture = { current: { suppressSelection: false } };
      const select = vi.fn();
      canvas.addEventListener('click', () => {
        if (!gesture.current.suppressSelection) select();
      });
      const cleanup = attachMapInput(canvas, active, gesture);
      canvas.dispatchEvent(pointer('pointerdown', 10, 10));
      canvas.dispatchEvent(pointer('pointerup', 10, 10));
      canvas.dispatchEvent(pointer('lostpointercapture', 10, 10));
      canvas.click();
      expect(select).toHaveBeenCalledOnce();
      cleanup();
      canvas.remove();
    },
  );
  it('cancels unexpected in-flight capture loss and cannot select from that gesture', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const gesture = { current: { suppressSelection: false } };
    const cancel = vi.fn();
    canvas.addEventListener('pointercancel', cancel);
    const cleanup = attachMapInput(canvas, true, gesture);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    canvas.dispatchEvent(pointer('lostpointercapture', 10, 10));
    expect(gesture.current.suppressSelection).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    cleanup();
    canvas.remove();
  });
  it('observes passive drag without cancelling scroll or taking pointer capture, and hints once', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const capture = vi.fn();
    canvas.setPointerCapture = capture;
    const hint = vi.fn();
    const gesture = { current: { suppressSelection: false } };
    const cleanup = attachMapInput(canvas, false, gesture, hint);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    const move = pointer('pointermove', 10, 70);
    document.dispatchEvent(move);
    document.dispatchEvent(pointer('pointermove', 10, 90));
    expect(move.defaultPrevented).toBe(false);
    expect(capture).not.toHaveBeenCalled();
    expect(hint).toHaveBeenCalledOnce();
    expect(gesture.current.suppressSelection).toBe(true);
    cleanup();
    canvas.remove();
  });
  it('reasserts passive touch ownership after controls connect and cancels all in-flight pointers on disarm', () => {
    let finish!: FrameRequestCallback;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback) => {
        finish = callback;
        return 1;
      }),
    );
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const gesture = { current: { suppressSelection: false } };
    const cancellation = vi.fn();
    canvas.addEventListener('pointercancel', cancellation);
    const cleanup = attachMapInput(canvas, false, gesture);
    canvas.style.touchAction = 'none';
    finish(0);
    expect(canvas.style.touchAction).toBe('auto');
    canvas.dispatchEvent(pointer('pointerdown', 10, 10, 1));
    canvas.dispatchEvent(pointer('pointerdown', 30, 10, 2));
    cleanup();
    expect(cancellation).toHaveBeenCalledTimes(2);
    expect(gesture.current.suppressSelection).toBe(true);
    canvas.remove();
    vi.unstubAllGlobals();
  });
  it('keeps activated pointer focus on the canvas and restores its original accessibility attributes', () => {
    const toolbar = document.createElement('button');
    const canvas = document.createElement('canvas');
    canvas.setAttribute('tabindex', '-1');
    canvas.setAttribute('aria-label', 'Original name');
    document.body.append(toolbar, canvas);
    const cleanup = attachMapInput(canvas, true, {
      current: { suppressSelection: false },
    });
    expect(canvas.tabIndex).toBe(0);
    toolbar.focus();
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(document.activeElement).toBe(canvas);
    cleanup();
    expect(canvas.getAttribute('tabindex')).toBe('-1');
    expect(canvas.getAttribute('aria-label')).toBe('Original name');
    toolbar.remove();
    canvas.remove();
  });
  it.each([false, true])(
    'gates ordinary wheel by interaction and leaves browser zoom native with active=%s',
    (active) => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const orbitWheel = vi.fn((event: Event) => event.preventDefault());
      canvas.addEventListener('wheel', orbitWheel);
      const cleanup = attachMapInput(canvas, active, {
        current: { suppressSelection: false },
      });
      for (const modifier of ['ordinary', 'ctrl', 'meta']) {
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 100,
          ctrlKey: modifier === 'ctrl',
          metaKey: modifier === 'meta',
        });
        const owned = active && modifier === 'ordinary';
        expect(canvas.dispatchEvent(event)).toBe(!owned);
        expect(event.defaultPrevented).toBe(owned);
      }
      expect(orbitWheel).toHaveBeenCalledTimes(active ? 1 : 0);
      expect(canvas.style.touchAction).toBe(active ? 'none' : 'auto');
      cleanup();
      canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true }));
      expect(orbitWheel).toHaveBeenCalledTimes(active ? 2 : 1);
      canvas.remove();
    },
  );
  it('keeps a tap selectable but suppresses a swipe even if it returns to its origin', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const gesture = { current: { suppressSelection: false } };
    const cleanup = attachMapInput(canvas, false, gesture);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    document.dispatchEvent(pointer('pointerup', 10, 10));
    expect(gesture.current.suppressSelection).toBe(false);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    document.dispatchEvent(pointer('pointermove', 10, 60));
    document.dispatchEvent(pointer('pointerup', 10, 10));
    expect(gesture.current.suppressSelection).toBe(true);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(gesture.current.suppressSelection).toBe(false);
    cleanup();
    canvas.remove();
  });
  it('suppresses pinch and cancelled scrolling gestures and removes document listeners', () => {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const gesture = { current: { suppressSelection: false } };
    const cleanup = attachMapInput(canvas, true, gesture);
    canvas.dispatchEvent(pointer('pointerdown', 10, 10, 1));
    canvas.dispatchEvent(pointer('pointerdown', 30, 10, 2));
    expect(gesture.current.suppressSelection).toBe(true);
    canvas.dispatchEvent(pointer('pointercancel', 10, 10, 1));
    document.dispatchEvent(pointer('pointerup', 30, 10, 2));
    cleanup();
    gesture.current.suppressSelection = false;
    document.dispatchEvent(pointer('pointermove', 200, 200, 2));
    expect(gesture.current.suppressSelection).toBe(false);
    expect(canvas.dataset.mapActive).toBeUndefined();
    canvas.remove();
  });
});
