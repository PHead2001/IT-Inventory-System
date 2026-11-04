import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RoomToolbar,
  placeRoomControls,
  roomControlsNeedInline,
} from './room-toolbar';

function setupToolbar({
  initialActive = true,
  canFocusSelected = true,
  onOverlayChange = vi.fn(),
  withinDialog = false,
} = {}) {
  const onActiveChange = vi.fn();
  const onRequestFocus = vi.fn(),
    onCommand = vi.fn();
  function Toolbar() {
    const [active, setActive] = useState(initialActive);
    return (
      <RoomToolbar
        active={active}
        onActiveChange={(value) => {
          onActiveChange(value);
          setActive(value);
        }}
        canFocusSelected={canFocusSelected}
        onRequestFocus={onRequestFocus}
        onCommand={onCommand}
        mode="guided"
        onModeChange={vi.fn()}
        showLabels={false}
        onLabelsChange={vi.fn()}
        showCounts={false}
        onCountsChange={vi.fn()}
        onOverlayChange={onOverlayChange}
      />
    );
  }
  const rendered = render(
    withinDialog ? (
      <dialog open>
        <Toolbar />
      </dialog>
    ) : (
      <Toolbar />
    ),
  );
  return {
    user: userEvent.setup(),
    onActiveChange,
    onRequestFocus,
    onCommand,
    unmount: rendered.unmount,
  };
}

describe('revealing view actions dismiss controls', () => {
  it.each([
    ['Fit room', 'pointer', true],
    ['Fit room', 'keyboard', false],
    ['Center selected', 'pointer', false],
    ['Center selected', 'keyboard', true],
  ] as const)(
    '%s through %s preserves invoking focus and interaction %s',
    async (name, input, active) => {
      const { user, onActiveChange, onCommand, onRequestFocus } = setupToolbar({
        initialActive: active,
      });
      const more = screen.getByRole('button', { name: 'More map controls' });
      await user.click(more);
      await user.click(screen.getByRole('button', { name: 'Controls' }));
      const button = screen.getByRole('button', { name });
      if (input === 'pointer') await user.click(button);
      else {
        // Shift+Tab from Help traverses the actual nonmodal panel and toolbar.
        for (
          let step = 0;
          step < 24 && document.activeElement !== button;
          step++
        )
          await user.tab({ shift: true });
        expect(button).toHaveFocus();
        await user.keyboard('{Enter}');
      }
      expect(
        screen.queryByRole('region', { name: 'More map controls' }),
      ).not.toBeInTheDocument();
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(button).toHaveFocus();
      expect(document.activeElement).not.toBe(document.body);
      expect(onActiveChange).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', {
          name: active ? 'Done interacting with map' : 'Interact with map',
        }),
      ).toHaveAttribute('aria-pressed', String(active));
      if (name === 'Fit room') {
        expect(onCommand).toHaveBeenCalledExactlyOnceWith('fit');
        expect(onRequestFocus).not.toHaveBeenCalled();
      } else {
        expect(onRequestFocus).toHaveBeenCalledOnce();
        expect(onCommand).not.toHaveBeenCalled();
      }
      await user.click(more);
      expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    },
  );
  it.each(['pointer', 'keyboard'])(
    'Recenter through %s returns focus to the surviving More trigger',
    async (input) => {
      const { user, onCommand, onActiveChange } = setupToolbar();
      const more = screen.getByRole('button', { name: 'More map controls' });
      await user.click(more);
      const recenter = screen.getByRole('button', { name: 'Recenter' });
      if (input === 'pointer') await user.click(recenter);
      else await user.keyboard(' ');
      expect(more).toHaveFocus();
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('region', { name: 'More map controls' }),
      ).not.toBeInTheDocument();
      expect(onCommand).toHaveBeenCalledExactlyOnceWith('recenter');
      expect(onActiveChange).not.toHaveBeenCalled();
    },
  );
  it('disabled Center selected does not dismiss or dispatch', async () => {
    const { user, onCommand, onRequestFocus, onActiveChange } = setupToolbar({
      canFocusSelected: false,
    });
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
    await user.click(screen.getByRole('button', { name: 'Center selected' }));
    expect(
      screen.getByRole('region', { name: 'More map controls' }),
    ).toBeVisible();
    expect(onCommand).not.toHaveBeenCalled();
    expect(onRequestFocus).not.toHaveBeenCalled();
    expect(onActiveChange).not.toHaveBeenCalled();
  });
  it.each(['Pan right', 'Rotate left'])(
    'keeps %s available for repeated commands',
    async (name) => {
      const { user, onCommand } = setupToolbar();
      await user.click(
        screen.getByRole('button', { name: 'More map controls' }),
      );
      const button = screen.getByRole('button', { name });
      await user.click(button);
      await user.click(button);
      expect(
        screen.getByRole('region', { name: 'More map controls' }),
      ).toBeVisible();
      expect(button).toHaveFocus();
      expect(onCommand).toHaveBeenCalledTimes(2);
    },
  );
});

describe('measured controls placement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const viewport = { left: 0, top: 0, right: 375, bottom: 812 };
  const anchor = { left: 30, top: 348, right: 345, bottom: 392 };
  const size = { width: 220, height: 200 };
  it('keeps the phone popup above the toolbar and out of the observed canvas', () => {
    const placed = placeRoomControls(anchor, viewport, size, true);
    expect(placed).toEqual({
      left: 125,
      top: 143,
      width: 220,
      maxHeight: 200,
      side: 'above',
    });
    expect(placed.top + placed.maxHeight).toBeLessThan(anchor.top);
    expect(placed.top + placed.maxHeight).toBeLessThan(404.046875);
  });
  it.each([
    [{ left: 30, top: 2, right: 345, bottom: 46 }, viewport, 'below'],
    [{ left: 4, top: 4, right: 120, bottom: 48 }, viewport, 'right'],
    [{ left: 255, top: 4, right: 371, bottom: 48 }, viewport, 'left'],
    [anchor, { left: 20, top: 300, right: 320, bottom: 510 }, 'below'],
    [
      { left: 4, top: 105, right: 371, bottom: 149 },
      { left: 0, top: 0, right: 375, bottom: 180 },
      'above',
    ],
    [{ left: 30, top: 900, right: 345, bottom: 944 }, viewport, 'above'],
    [{ left: -80, top: -80, right: 235, bottom: -36 }, viewport, 'below'],
  ] as const)(
    'falls back to %s inside the current visual viewport',
    (bounds, view, side) => {
      const placed = placeRoomControls(bounds, view, size, true);
      expect(placed.side).toBe(side);
      expect(placed.left).toBeGreaterThanOrEqual(view.left + 4);
      expect(placed.top).toBeGreaterThanOrEqual(view.top + 4);
      expect(placed.left + placed.width).toBeLessThanOrEqual(view.right - 4);
      expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(
        view.bottom - 4,
      );
      expect(placed.maxHeight).toBeGreaterThan(0);
      expect(placed.maxHeight).toBeLessThanOrEqual(200);
    },
  );
  it('coalesces open-only resize/scroll measurements without replacing or moving native focused actions on panel scroll', async () => {
    let bounds = anchor;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const raf = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frameCallbacks.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id: number) => frameCallbacks.delete(id));
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      },
    );
    const visual = Object.assign(new EventTarget(), {
      offsetLeft: 0,
      offsetTop: 0,
      width: 375,
      height: 812,
    });
    vi.stubGlobal('visualViewport', visual);
    const removeVisualListener = vi.spyOn(visual, 'removeEventListener');
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function () {
        return {
          ...bounds,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top,
          x: bounds.left,
          y: bounds.top,
          toJSON() {},
        };
      },
    );
    const onOverlayChange = vi.fn();
    const { user, onCommand, unmount } = setupToolbar({ onOverlayChange });
    window.dispatchEvent(new Event('resize'));
    expect(raf).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
    const panel = screen.getByRole('region', { name: 'More map controls' });
    const recenter = within(panel).getByRole('button', { name: 'Recenter' });
    expect(recenter).toHaveFocus();
    expect(panel.dataset.placement).toBe('above');
    const envelope = panel.getAttribute('style');
    const notifications = onOverlayChange.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    panel.dispatchEvent(new Event('scroll', { bubbles: true }));
    expect(raf).toHaveBeenCalledTimes(1);
    act(() => {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback(1));
    });
    expect(panel.getAttribute('style')).toBe(envelope);
    expect(recenter).toHaveFocus();
    expect(onOverlayChange).toHaveBeenCalledTimes(notifications);
    expect(frameCallbacks.size).toBe(0);
    bounds = { ...anchor, top: 2, bottom: 46 };
    window.dispatchEvent(new Event('resize'));
    act(() => {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback(2));
    });
    expect(panel.dataset.placement).toBe('inline');
    expect(recenter).toHaveFocus();
    expect(within(panel).getByRole('button', { name: 'Recenter' })).toBe(
      recenter,
    );
    Object.assign(visual, { offsetTop: 20, width: 300, height: 250 });
    visual.dispatchEvent(new Event('resize'));
    visual.dispatchEvent(new Event('scroll'));
    act(() => {
      const callbacks = [...frameCallbacks.values()];
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback(3));
    });
    expect(panel.dataset.placement).toBe('inline');
    expect(parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(87.5);
    expect(parseFloat(panel.style.width)).toBeLessThanOrEqual(292);
    expect(recenter).toHaveFocus();
    window.dispatchEvent(new Event('resize'));
    await user.keyboard('{Escape}');
    expect(cancel).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(removeVisualListener).toHaveBeenCalledTimes(2);
    const requested = raf.mock.calls.length;
    window.dispatchEvent(new Event('resize'));
    expect(raf).toHaveBeenCalledTimes(requested);
    expect(onCommand).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
    visual.dispatchEvent(new Event('resize'));
    unmount();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(removeVisualListener).toHaveBeenCalledTimes(4);
    expect(frameCallbacks.size).toBe(0);
  });
});

describe('room toolbar Escape', () => {
  it.each(['target', 'activeElement'] as const)(
    'leaves a foreground native dialog Escape (%s ownership) available for its cancel/focus return',
    async (origin) => {
      const { user, onActiveChange, onCommand } = setupToolbar();
      await user.click(
        screen.getByRole('button', { name: 'More map controls' }),
      );
      const opener = document.createElement('button');
      opener.textContent = 'Open foreground dialog';
      document.body.append(opener);
      const dialog = document.createElement('dialog');
      dialog.open = true;
      const control = document.createElement('button');
      control.textContent = 'Foreground control';
      dialog.append(control);
      document.body.append(dialog);
      dialog.addEventListener('cancel', () => {
        dialog.open = false;
        opener.focus();
      });
      try {
        control.focus();
        const escape = new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        });
        (origin === 'target' ? control : document).dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(false);
        expect(control).toHaveFocus();
        expect(onActiveChange).not.toHaveBeenCalled();
        expect(onCommand).not.toHaveBeenCalled();
        expect(
          screen.getByRole('region', { name: 'More map controls' }),
        ).toBeVisible();
        // jsdom has no native Escape default action; deliver the browser cancel
        // request separately only after proving the background did not cancel it.
        fireEvent(dialog, new Event('cancel', { cancelable: true }));
        expect(dialog.open).toBe(false);
        expect(opener).toHaveFocus();
      } finally {
        dialog.remove();
        opener.remove();
      }
    },
  );
  it('honors an already handled Escape without changing interaction or focus', () => {
    const { onActiveChange } = setupToolbar();
    const trigger = screen.getByRole('button', {
      name: 'Done interacting with map',
    });
    trigger.focus();
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    escape.preventDefault();
    act(() => trigger.dispatchEvent(escape));
    expect(onActiveChange).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
  it('still handles Escape from its own native modal and restores its own Interact control', async () => {
    const { user, onActiveChange } = setupToolbar({ withinDialog: true });
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
    await user.keyboard('{Escape}');
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveFocus();
  });
  it('focuses the first popover control then Escape disarms and restores Interact', async () => {
    const { user, onActiveChange } = setupToolbar();
    const more = screen.getByRole('button', { name: 'More map controls' });
    for (let index = 0; index < 6; index += 1) await user.tab();
    expect(more).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('region', { name: 'More map controls' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recenter' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveFocus();
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('closes from a panel descendant, resets help, and returns focus to More', async () => {
    const { user, onActiveChange } = setupToolbar();
    const more = screen.getByRole('button', { name: 'More map controls' });
    await user.click(more);
    const panel = screen.getByRole('region', { name: 'More map controls' });
    await user.click(within(panel).getByRole('button', { name: 'Controls' }));
    expect(
      within(panel).getByText(/Click or tap a location to select it/),
    ).toBeVisible();
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Interact with map' }),
    ).toHaveFocus();
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('narrow controls leave the canvas clear', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  const viewport = { left: 0, top: 0, right: 375, bottom: 812 };
  it('uses flow at 375px when the complete panel cannot fit above', () => {
    const row = { left: 30, top: 103, right: 345, bottom: 147 };
    expect(roomControlsNeedInline(row, viewport, 200, true)).toBe(true);
    expect(
      roomControlsNeedInline({ ...row, top: 209 }, viewport, 200, true),
    ).toBe(false);
    expect(roomControlsNeedInline(row, viewport, 200, false)).toBe(false);
    expect(
      roomControlsNeedInline(
        { ...row, top: 209 },
        { ...viewport, top: 1 },
        200,
        true,
      ),
    ).toBe(true);
  });
  it('latches flow across scroll and row resize, resets on width class and close, and retains controls and focus', async () => {
    let row = { left: 30, top: 103, right: 345, bottom: 147 };
    let hostReads = 0;
    const observed: Element[] = [];
    let onResize: ResizeObserverCallback = () => {};
    const frames = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          onResize = callback;
        }
        observe(element: Element) {
          observed.push(element);
        }
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'visualViewport',
      Object.assign(new EventTarget(), {
        offsetLeft: 0,
        offsetTop: 0,
        width: 1200,
        height: 812,
      }),
    );
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function () {
        if (this.querySelector('[role="toolbar"]')) hostReads++;
        return {
          ...row,
          width: row.right - row.left,
          height: row.bottom - row.top,
          x: row.left,
          y: row.top,
          toJSON() {},
        };
      },
    );
    const flush = () =>
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(1));
      });
    const onOverlayChange = vi.fn();
    const { user, onCommand, onActiveChange } = setupToolbar({
      onOverlayChange,
    });
    const more = screen.getByRole('button', { name: 'More map controls' });
    await user.click(more);
    const panel = screen.getByRole('region', { name: 'More map controls' });
    const recenter = within(panel).getByRole('button', { name: 'Recenter' });
    expect(panel.dataset.placement).toBe('inline');
    expect(panel).toHaveAttribute('data-room-obstruction', 'true');
    expect(recenter).toHaveFocus();
    expect(observed).toContain(screen.getByRole('toolbar'));
    expect(hostReads).toBe(0);
    for (const name of [
      'Guided',
      'Free Orbit',
      'Pan up',
      'Pan left',
      'Pan right',
      'Pan down',
      'Rotate left',
      'Rotate right',
      'Tilt up',
      'Tilt down',
      'Show labels',
      'Show item counts',
      'Controls',
      'Close controls',
    ]) {
      expect(within(panel).getByRole('button', { name })).toBeEnabled();
    }
    const notifications = onOverlayChange.mock.calls.length;
    row = { ...row, top: 500, bottom: 544 };
    window.dispatchEvent(new Event('scroll'));
    act(() => onResize([], {} as ResizeObserver));
    expect(frames.size).toBe(1);
    flush();
    expect(panel.dataset.placement).toBe('inline');
    expect(recenter).toHaveFocus();
    expect(onOverlayChange).toHaveBeenCalledTimes(notifications);
    expect(frames.size).toBe(0);
    row = { ...row, right: 900 };
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(panel.dataset.placement).toBe('below');
    expect(onOverlayChange.mock.calls.length).toBeGreaterThan(notifications);
    expect(within(panel).getByRole('button', { name: 'Recenter' })).toBe(
      recenter,
    );
    row = { ...row, right: 345 };
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(panel.dataset.placement).toBe('above');
    row = { ...row, top: 103, bottom: 147 };
    window.dispatchEvent(new Event('scroll'));
    flush();
    expect(panel.dataset.placement).toBe('inline');
    await user.click(within(panel).getByRole('button', { name: 'Pan right' }));
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('right');
    expect(panel).toBeVisible();
    await user.click(
      within(panel).getByRole('button', { name: 'Close controls' }),
    );
    expect(more).toHaveFocus();
    row = { ...row, top: 500, bottom: 544 };
    await user.click(more);
    expect(
      screen.getByRole('region', { name: 'More map controls' }).dataset
        .placement,
    ).toBe('above');
    await user.keyboard('{Escape}');
    expect(onActiveChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
    row = { ...row, top: 103, bottom: 147 };
    await user.click(more);
    expect(
      screen.getByRole('region', { name: 'More map controls' }).dataset
        .placement,
    ).toBe('inline');
    fireEvent.pointerDown(document.body);
    expect(
      screen.queryByRole('region', { name: 'More map controls' }),
    ).not.toBeInTheDocument();
  });
});
