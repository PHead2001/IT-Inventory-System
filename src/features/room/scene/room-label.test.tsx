import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoomLabel, knownOccupiedCount } from './room-label';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';

describe('room counts', () => {
  it.each([undefined, '0', '-1', 'NaN', 'Infinity', '1.5', '01', ''])(
    'does not present %s as occupied stock',
    (count) => {
      expect(knownOccupiedCount(count)).toBeNull();
    },
  );
  it('preserves counts beyond number precision', () => {
    expect(knownOccupiedCount('9007199254740993')).toBe('9007199254740993');
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
          count="3"
          onSelect={vi.fn()}
        />
      </LabelLayoutProvider>,
    );
    expect(
      screen.getByRole('button', {
        name: /Select Drawer 1.*3 active inventory entries/,
      }),
    ).toHaveTextContent('3 items');
    expect(register).toHaveBeenCalledWith(
      'drawer',
      expect.any(HTMLButtonElement),
      expect.any(HTMLSpanElement),
      { priority: 3, locationCode: 'ITC-D01', interactive: true },
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
          count="0"
          onSelect={vi.fn()}
        />
      </LabelLayoutProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent(/^Drawer 1$/);
  });
});
