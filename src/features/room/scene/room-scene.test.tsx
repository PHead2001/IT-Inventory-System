import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RoomScene, { type RoomSceneProps } from './room-scene';

vi.mock('./safe-canvas', () => ({
  SafeCanvas: () => <div data-testid="mock-canvas" />,
}));

function sceneProps(overrides: Partial<RoomSceneProps> = {}): RoomSceneProps {
  return {
    room: {
      nodes: [],
      rackFaceProfiles: [],
    } as unknown as RoomSceneProps['room'],
    bindings: [],
    selectedCode: null,
    highlightedCodes: [],
    focusRequest: { code: null, requestId: 0 },
    onSelect: vi.fn(),
    onReady: vi.fn(),
    onFocusComplete: vi.fn(),
    onFailure: vi.fn(),
    canFocusSelected: false,
    onRequestFocus: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => window.localStorage.clear());

describe('room scene controls', () => {
  it('keeps repeated Center selected requests available only for a focusable selection', async () => {
    const user = userEvent.setup();
    const onRequestFocus = vi.fn();
    const view = render(<RoomScene {...sceneProps({ onRequestFocus })} />);
    const button = screen.getByRole('button', { name: 'Center selected' });
    expect(button).toBeDisabled();
    view.rerender(
      <RoomScene {...sceneProps({ canFocusSelected: true, onRequestFocus })} />,
    );
    await user.click(button);
    await user.click(button);
    expect(onRequestFocus).toHaveBeenCalledTimes(2);
  });

  it('offers both modes and persists Free Orbit for a new scene mount', async () => {
    const user = userEvent.setup();
    const view = render(<RoomScene {...sceneProps()} />);
    const free = screen.getByRole('button', { name: 'Free Orbit' });
    expect(screen.getByRole('button', { name: 'Guided' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(free);
    expect(free).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('room-orbit-mode')).toBe('free');
    view.unmount();
    render(<RoomScene {...sceneProps()} />);
    expect(screen.getByRole('button', { name: 'Free Orbit' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Recenter' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Fit room' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  });

  it('starts with labels hidden, exposes tilt controls, and resets the label choice for a new room', async () => {
    const user = userEvent.setup();
    const first = sceneProps();
    const view = render(<RoomScene {...first} />);
    const toggle = screen.getByRole('button', { name: 'Show all labels' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByText('Pan and rotate'));
    expect(screen.getByRole('button', { name: 'Tilt up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Tilt down' })).toBeEnabled();
    view.rerender(<RoomScene {...sceneProps()} />);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('announces a selected room object outside the canvas', () => {
    const props = sceneProps({ selectedCode: 'ITC-S1A' });
    props.room.nodes = [
      {
        id: 'unrelated-group',
        children: [{ id: 'unrelated-child', locationCode: 'ITC-R' }],
      } as RoomSceneProps['room']['nodes'][number],
      {
        id: 'section',
        locationCode: 'ITC-S1A',
        interaction: { label: 'Shelf 1A' },
      } as RoomSceneProps['room']['nodes'][number],
    ];
    render(<RoomScene {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Selected location: Shelf 1A (ITC-S1A)',
    );
  });
});
