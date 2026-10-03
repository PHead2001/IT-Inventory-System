import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrthographicCamera, Vector3 } from 'three';
import RoomScene, {
  finishFocusAnimation,
  type RoomSceneProps,
} from './room-scene';

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
  it('finishes an interrupted focus at its intended valid target and zoom', () => {
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 3000);
    const target = new Vector3(2, 3, 4);
    const offset = new Vector3(15, 20, 25);
    finishFocusAnimation(camera, target, {
      to: new Vector3(30, 40, 50),
      offset,
      toZoom: 1.5,
    });
    expect(target.toArray()).toEqual([30, 40, 50]);
    expect(camera.position.toArray()).toEqual([45, 60, 75]);
    expect(camera.zoom).toBe(1.5);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
  });
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

it('shows the live authorized display name for a bound location without changing geometry', () => {
  const props = sceneProps({
    selectedCode: 'ITC-S1A',
    locationNames: { 'ITC-S1A': 'Adapters shelf' },
  });
  const room = props.room;
  render(<RoomScene {...props} />);
  expect(screen.getByText(/Selected location: Adapters shelf/)).toBeVisible();
  expect(props.room).toBe(room);
});
