import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoomLabel } from './room-label';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';

describe('room counts', () => {
  it('registers the stable current physical-anchor callback separately from visibility', () => {
    const registry = createRoomLabelRegistry(vi.fn()),
      register = vi.spyOn(registry, 'register');
    const isVisible = vi.fn(() => true),
      pickReservation = vi.fn(() => ({
        left: 10,
        top: 10,
        right: 22,
        bottom: 22,
      }));
    const view = render(
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id="reserved"
          label="Drawer"
          code="ITC-D01"
          priority={4}
          selected
          onSelect={vi.fn()}
          isVisible={isVisible}
          pickReservation={pickReservation}
        />
      </LabelLayoutProvider>,
    );
    expect(register.mock.lastCall?.[3]).toMatchObject({
      isVisible,
      pickReservation,
    });
    expect(pickReservation).not.toHaveBeenCalled();
    view.unmount();
  });
  it('keeps selected preview labels readable without selection tab stops', () => {
    render(
      <LabelLayoutProvider registry={createRoomLabelRegistry(vi.fn())}>
        <RoomLabel
          id="preview"
          code="ITC-D01"
          label="Drawer 1"
          priority={3}
          selected
          occupancy={{
            quantity_product_count: '1',
            quantity_unit_count: '2',
            asset_count: '0',
          }}
        />
      </LabelLayoutProvider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Drawer 1')).toBeVisible();
    expect(
      document.querySelector('[data-room-decorative-label]'),
    ).not.toHaveAttribute('tabindex');
    expect(document.body).toHaveTextContent('1 product / 2 units / 0 assets');
  });
  it.each([
    ['0', '0 products / 0 units / 0 assets'],
    ['9007199254740993', '1 product / 9,007,199,254,740,993 units / 0 assets'],
  ])(
    'selected reveal shows the exact known %s count while unknown remains unknown',
    (units, expected) => {
      const registry = createRoomLabelRegistry(vi.fn());
      const view = render(
        <LabelLayoutProvider registry={registry}>
          <RoomLabel
            id="selected"
            code="ITC-D01"
            label="Drawer 1"
            priority={3}
            selected
            occupancy={{
              quantity_product_count: units === '0' ? '0' : '1',
              quantity_unit_count: units,
              asset_count: '0',
            }}
            onSelect={vi.fn()}
          />
        </LabelLayoutProvider>,
      );
      expect(
        screen.getByRole('button', {
          name: `Select Drawer 1 (ITC-D01); ${expected} at this location`,
        }),
      ).toHaveTextContent(expected);
      view.rerender(
        <LabelLayoutProvider registry={registry}>
          <RoomLabel
            id="selected"
            code="ITC-D01"
            label="Drawer 1"
            priority={3}
            selected
            onSelect={vi.fn()}
          />
        </LabelLayoutProvider>,
      );
      expect(
        screen.getByRole('button', { name: 'Select Drawer 1 (ITC-D01)' }),
      ).toHaveTextContent(/^Drawer 1$/);
    },
  );
  it('retains the full long name and distinct counts for keyboard focus, then restores its compact marker', async () => {
    const registry = createRoomLabelRegistry(vi.fn());
    const register = vi.spyOn(registry, 'register');
    const user = userEvent.setup();
    const label =
      'Shared equipment drawer for replacement laptop adapters and carefully packed networking accessories';
    render(
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id="long"
          code="ITC-D01"
          label={label}
          priority={1}
          occupancy={{
            quantity_product_count: '1',
            quantity_unit_count: '31',
            asset_count: '2',
          }}
          onSelect={vi.fn()}
        />
      </LabelLayoutProvider>,
    );
    const button = screen.getByRole('button', {
      name: `Select ${label} (ITC-D01); 1 product / 31 units / 2 assets at this location`,
    });
    expect(register.mock.lastCall?.[3]).toMatchObject({
      mandatory: true,
      compact: true,
      priority: 3,
    });
    await user.tab();
    expect(button).toHaveFocus();
    expect(register.mock.lastCall?.[3]).toMatchObject({
      mandatory: true,
      compact: true,
      preferFull: true,
      inspection: 'focus',
      priority: 3,
    });
    expect(button).toHaveTextContent(label);
    await user.tab();
    expect(register.mock.lastCall?.[3]).toMatchObject({
      mandatory: true,
      compact: true,
      priority: 3,
    });
  });
  it('registers one measured label including its truthful active-entry count', () => {
    const registry = createRoomLabelRegistry(vi.fn());
    const register = vi.spyOn(registry, 'register');
    render(
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id="drawer"
          code="ITC-D01"
          label="Drawer 1"
          priority={3}
          selected
          occupancy={{
            quantity_product_count: '1',
            quantity_unit_count: '31',
            asset_count: '2',
          }}
          onSelect={vi.fn()}
        />
      </LabelLayoutProvider>,
    );
    expect(
      screen.getByRole('button', {
        name: /Select Drawer 1.*1 product \/ 31 units \/ 2 assets/,
      }),
    ).toHaveTextContent('1 product / 31 units / 2 assets');
    expect(register).toHaveBeenCalledWith(
      'drawer',
      expect.any(HTMLButtonElement),
      expect.any(HTMLSpanElement),
      expect.objectContaining({
        priority: 4,
        locationCode: 'ITC-D01',
        interactive: true,
        mandatory: true,
        compact: false,
      }),
    );
  });
  it('omits unknown and known-zero badges without fabricating empty-drawer text', () => {
    const registry = createRoomLabelRegistry(vi.fn());
    const view = render(
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id="drawer"
          code="ITC-D01"
          label="Drawer 1"
          priority={1}
          onSelect={vi.fn()}
        />
      </LabelLayoutProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent(/^Drawer 1$/);
    view.rerender(
      <LabelLayoutProvider registry={registry}>
        <RoomLabel
          id="drawer"
          code="ITC-D01"
          label="Drawer 1"
          priority={1}
          occupancy={{
            quantity_product_count: '0',
            quantity_unit_count: '0',
            asset_count: '0',
          }}
          onSelect={vi.fn()}
        />
      </LabelLayoutProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent(/^Drawer 1$/);
  });
});
