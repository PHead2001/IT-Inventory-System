import { describe, expect, it, vi } from 'vitest';
import { attachMapInput } from './map-input';

function pointer(type: string, x: number, y: number, id = 1) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(event, 'pointerId', { value: id });
  return event;
}
describe('map input ownership', () => {
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
    'leaves plain and modified wheel native with active=%s',
    (active) => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const orbitWheel = vi.fn((event: Event) => event.preventDefault());
      canvas.addEventListener('wheel', orbitWheel);
      const cleanup = attachMapInput(canvas, active, {
        current: { suppressSelection: false },
      });
      for (const ctrlKey of [false, true]) {
        const event = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: 100,
          ctrlKey,
        });
        expect(canvas.dispatchEvent(event)).toBe(true);
        expect(event.defaultPrevented).toBe(false);
      }
      expect(orbitWheel).not.toHaveBeenCalled();
      expect(canvas.style.touchAction).toBe(active ? 'none' : 'auto');
      cleanup();
      canvas.dispatchEvent(new WheelEvent('wheel', { cancelable: true }));
      expect(orbitWheel).toHaveBeenCalledOnce();
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
