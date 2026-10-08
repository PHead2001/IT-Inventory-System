import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { attachMapInput } from './map-input';
import { OrthographicCamera, Vector3 } from 'three';
import RoomScene, {
  finishFocusAnimation,
  type RoomSceneProps,
} from './room-scene';

vi.mock('./safe-canvas', () => ({
  SafeCanvas: () => <canvas data-testid="mock-canvas" />,
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
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
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
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
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
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
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

  it('requires explicit activation and disarms through Done, Escape and focus leaving the map', async () => {
    const user = userEvent.setup();
    render(
      <>
        <RoomScene {...sceneProps()} />
        <button>Outside the map</button>
      </>,
    );
    const activate = () =>
      screen.getByRole('button', { name: 'Interact with map' });
    expect(activate()).toHaveAttribute('aria-pressed', 'false');
    await user.click(activate());
    await user.click(
      screen.getByRole('button', { name: 'Done interacting with map' }),
    );
    expect(activate()).toHaveAttribute('aria-pressed', 'false');
    await user.click(activate());
    await user.keyboard('{Escape}');
    expect(activate()).toHaveAttribute('aria-pressed', 'false');
    await user.click(activate());
    const canvas = screen.getByTestId('mock-canvas') as HTMLCanvasElement;
    const cleanup = attachMapInput(canvas, true, {
      current: { suppressSelection: false },
    });
    await user.click(canvas);
    expect(canvas).toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Done interacting with map' }),
    ).toHaveAttribute('aria-pressed', 'true');
    cleanup();
    await user.click(screen.getByRole('button', { name: 'Outside the map' }));
    expect(activate()).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['activation', 'Pan left', 'Controls'])(
    'releases map interaction with one Escape from the overflow %s control without losing selection',
    async (control) => {
      const user = userEvent.setup();
      const props = sceneProps({ selectedCode: 'ITC-S1A' });
      render(<RoomScene {...props} />);
      const more = screen.getByRole('button', { name: 'More map controls' });
      await user.click(more);
      const panel = screen.getByRole('region', { name: 'More map controls' });
      // Narrow layouts put activation in the overflow. Use that real button
      // rather than the primary toolbar's copy, regardless of jsdom layout.
      await user.click(
        within(panel).getByRole('button', { name: 'Interact with map' }),
      );
      expect(
        within(panel).getByRole('button', {
          name: 'Done interacting with map',
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      if (control !== 'activation') {
        await user.click(within(panel).getByRole('button', { name: control }));
      }

      await user.keyboard('{Escape}');

      expect(more).toHaveFocus();
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.queryByRole('region', { name: 'More map controls' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Interact with map' }),
      ).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByRole('status')).toHaveTextContent(
        'Selected location: ITC-S1A',
      );
      expect(props.onSelect).not.toHaveBeenCalled();

      // Escape leaves ordinary controls usable and resets help disclosure.
      await user.keyboard('{Enter}');
      expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      const reopened = screen.getByRole('region', {
        name: 'More map controls',
      });
      await user.click(
        within(reopened).getByRole('button', { name: 'Interact with map' }),
      );
      expect(
        within(reopened).getByRole('button', {
          name: 'Done interacting with map',
        }),
      ).toHaveAttribute('aria-pressed', 'true');
    },
  );

  it('keeps instructions short and restores focus after complete controls help', async () => {
    const user = userEvent.setup();
    render(<RoomScene {...sceneProps()} />);
    const more = screen.getByRole('button', { name: 'More map controls' });
    await user.click(more);
    await user.click(screen.getByRole('button', { name: /^Controls$/ }));
    expect(
      screen.getByText(/Item counts are active inventory entries/),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Show item counts' }),
    ).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: 'Show item counts' }));
    expect(
      screen.getByRole('button', { name: 'Show item counts' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{Escape}');
    expect(more).toHaveFocus();
    expect(more).toHaveAttribute('aria-expanded', 'false');
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
