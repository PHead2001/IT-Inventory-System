import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { RoomLabel } from './room-label';
import {
  createRoomLabelRegistry,
  LabelLayoutProvider,
} from './label-layout-runtime';
import * as packing from './label-layout';

const occupied = {
  quantity_product_count: '2',
  quantity_unit_count: '31',
  asset_count: '1',
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('renders an explicit occupied badge as a readonly span with no activation or tab stop, then promotes selection to full text', async () => {
  const select = vi.fn();
  const registry = createRoomLabelRegistry(vi.fn());
  const registration = vi.spyOn(registry, 'register');
  const draw = (selected: boolean, occupancy: typeof occupied | undefined) => (
    <LabelLayoutProvider registry={registry}>
      <RoomLabel
        id="drawer-1"
        code="ITC-D01"
        label="Drawer 1"
        priority={1}
        selected={selected}
        presentation="occupied-marker"
        occupancy={occupancy}
        onSelect={select}
      />
      <button type="button">Conventional selection</button>
    </LabelLayoutProvider>
  );
  const view = render(draw(false, occupied));
  const badge = screen.getByRole('img', {
    name: /Drawer 1.*Occupied.*2 products \/ 31 units \/ 1 asset/,
  });
  expect(badge.tagName).toBe('SPAN');
  expect(badge).toHaveAttribute('data-room-occupied-marker', 'true');
  expect(badge).not.toHaveAttribute('tabindex');
  badge.focus();
  expect(badge).not.toHaveFocus();
  expect(badge).toHaveStyle({ pointerEvents: 'none' });
  expect(badge.querySelector('svg')).toHaveAttribute('width', '22');
  expect(badge.closest('[data-room-passive-wrapper]')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Drawer 1/ })).toBeNull();
  expect(registration.mock.lastCall?.[3]).toMatchObject({
    presentation: 'occupied-marker',
    interactive: false,
    mandatory: true,
    compact: true,
    preferFull: false,
    inspection: null,
  });
  fireEvent.click(badge);
  fireEvent.keyDown(badge, { key: 'Enter' });
  fireEvent.keyDown(badge, { key: ' ' });
  expect(select).not.toHaveBeenCalled();
  await userEvent.setup().tab();
  expect(
    screen.getByRole('button', { name: 'Conventional selection' }),
  ).toHaveFocus();
  view.rerender(draw(true, occupied));
  const full = screen.getByRole('button', {
    name: /Select Drawer 1.*2 products \/ 31 units \/ 1 asset/,
  });
  expect(full).toHaveAttribute('aria-pressed', 'true');
  expect(full).not.toHaveAttribute('data-room-occupied-marker');
  expect(full.querySelector('[data-room-label-full]')).toHaveTextContent(
    'Drawer 1',
  );
  expect(registration.mock.lastCall?.[3]).toMatchObject({
    priority: 4,
    interactive: true,
    mandatory: true,
    compact: false,
  });
  expect(registration.mock.lastCall?.[3].presentation).toBeUndefined();
  fireEvent.click(full);
  expect(select).toHaveBeenCalledExactlyOnceWith('ITC-D01');
  view.rerender(draw(false, undefined));
  expect(screen.queryByRole('img')).toBeNull();
  view.rerender(
    draw(false, {
      quantity_product_count: '0',
      quantity_unit_count: '0',
      asset_count: '0',
    }),
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Select Drawer 1 (ITC-D01)' }),
  ).toHaveTextContent(/^Drawer 1$/);
});

it('rejects interactive or selected DOM shapes under passive metadata and forces a real span to stay readonly', () => {
  const registry = createRoomLabelRegistry(vi.fn());
  for (const tag of ['button', 'a', 'input']) {
    expect(() =>
      registry.register(
        tag,
        document.createElement(tag),
        document.createElement('span'),
        { priority: 3, presentation: 'occupied-marker' },
      ),
    ).toThrow('readonly span');
  }
  const span = document.createElement('span');
  expect(() =>
    registry.register('selected', span, document.createElement('span'), {
      priority: 4,
      presentation: 'occupied-marker',
    }),
  ).toThrow('readonly span');
  span.setAttribute('role', 'button');
  expect(() =>
    registry.register('role', span, document.createElement('span'), {
      priority: 3,
      presentation: 'occupied-marker',
    }),
  ).toThrow('readonly span');
});

it('measures the actual passive badge separately from the unchanged 44px interactive footprint in the real registry', () => {
  let frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const bounds = (
    left: number,
    top: number,
    width: number,
    height: number,
  ) => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return {
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
      };
    },
  });
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  host.append(canvas);
  document.body.append(host);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(
    bounds(0, 0, 300, 200),
  );
  const marker = document.createElement('span'),
    button = document.createElement('button'),
    text = document.createElement('span');
  text.dataset.roomLabelFull = 'true';
  button.append(text);
  host.append(marker, button);
  for (const [element, left, size] of [
    [marker, 20, 24],
    [button, 100, 44],
  ] as const) {
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() =>
      bounds(
        left + Number(element.dataset.labelDx ?? 0),
        50 + Number(element.dataset.labelDy ?? 0),
        size,
        size,
      ),
    );
  }
  vi.spyOn(text, 'getBoundingClientRect').mockReturnValue(
    bounds(108, 56, 10, 10),
  );
  const real = packing.layoutLabelsDetailed;
  const solver = vi
    .spyOn(packing, 'layoutLabelsDetailed')
    .mockImplementation((...args) => real(...args));
  const registry = createRoomLabelRegistry(vi.fn(), undefined, undefined, {
    clock: () => 0,
  });
  const disconnect = registry.connect(canvas);
  const unmarker = registry.register(
    'badge',
    marker,
    document.createElement('span'),
    {
      priority: 3,
      locationCode: 'A',
      mandatory: true,
      presentation: 'occupied-marker',
      interactive: true,
      preferFull: true,
      inspection: 'focus',
    },
  );
  const unbutton = registry.register(
    'action',
    button,
    document.createElement('span'),
    { priority: 4, locationCode: 'B', mandatory: true, interactive: true },
  );
  const current = frames;
  frames = [];
  current.forEach((callback) => callback(0));
  const measured = solver.mock.calls[0][0];
  expect(measured.find((label) => label.id === 'badge')).toMatchObject({
    width: 24,
    height: 24,
    compact: { width: 24, height: 24 },
    presentation: 'occupied-marker',
    preferFull: false,
    focused: false,
    hovered: false,
  });
  expect(measured.find((label) => label.id === 'action')).toMatchObject({
    width: 44,
    height: 44,
    selected: true,
  });
  expect(marker.dataset.labelSuppressed).toBe('false');
  expect(marker).toHaveStyle({ pointerEvents: 'none' });
  expect(marker.tabIndex).toBe(-1);
  expect(button.style.pointerEvents).toBe('auto');
  expect(button.tabIndex).toBe(0);
  unmarker();
  unbutton();
  disconnect();
  host.remove();
});

it.each(['focus', 'hover'] as const)(
  'keeps the same full button through current %s when an accepted positive occupancy arrives, then yields only after the interaction ends',
  async (interaction) => {
    const registry = createRoomLabelRegistry(vi.fn());
    const registration = vi.spyOn(registry, 'register');
    const user = userEvent.setup();
    const draw = (occupancy?: typeof occupied) => (
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id="drawer-1"
          code="ITC-D01"
          label="Drawer 1"
          priority={1}
          presentation="occupied-marker"
          occupancy={occupancy}
          onSelect={vi.fn()}
        />
        <button type="button">Next conventional control</button>
      </LabelLayoutProvider>
    );
    const view = render(draw());
    const original = screen.getByRole('button', {
      name: 'Select Drawer 1 (ITC-D01)',
    });
    if (interaction === 'focus') {
      await user.tab();
      expect(original).toHaveFocus();
    } else await user.hover(original);
    view.rerender(draw(occupied));
    const full = screen.getByRole('button', {
      name: /Select Drawer 1.*2 products \/ 31 units \/ 1 asset/,
    });
    expect(full).toBe(original);
    expect(full).not.toHaveAttribute('data-room-occupied-marker');
    expect(full.querySelector('[data-room-label-full]')).toHaveTextContent(
      'Drawer 1',
    );
    expect(registration.mock.lastCall?.[3]).toMatchObject({
      interactive: true,
      mandatory: true,
      compact: false,
      preferFull: true,
      inspection: interaction,
    });
    expect(registration.mock.lastCall?.[3].presentation).toBeUndefined();
    if (interaction === 'focus') {
      expect(full).toHaveFocus();
      await user.tab();
      expect(
        screen.getByRole('button', { name: 'Next conventional control' }),
      ).toHaveFocus();
    } else await user.unhover(full);
    expect(original.isConnected).toBe(false);
    const marker = screen.getByRole('img', { name: /Drawer 1.*Occupied/ });
    expect(marker.tagName).toBe('SPAN');
    expect(marker).not.toHaveAttribute('tabindex');
    marker.focus();
    expect(marker).not.toHaveFocus();
    expect(registration.mock.lastCall?.[3]).toMatchObject({
      presentation: 'occupied-marker',
      interactive: false,
      compact: true,
      preferFull: false,
      inspection: null,
    });
  },
);
