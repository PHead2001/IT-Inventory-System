import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { attachMapInput } from './map-input';
import { OrthographicCamera, Vector3 } from 'three';
import { Children, isValidElement, type ReactNode } from 'react';
import type { RoomNode } from '../schema';
import type { RoomLabelRegistry } from './label-layout-runtime';
import RoomScene, {
  finishFocusAnimation,
  hasRenderedSelection,
  type RoomSceneProps,
} from './room-scene';

const sceneCanvas = vi.hoisted(() => ({ children: null as ReactNode }));
vi.mock('./safe-canvas', () => ({
  SafeCanvas: ({ children }: { children: ReactNode }) => {
    sceneCanvas.children = children;
    return <canvas data-testid="mock-canvas" />;
  },
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
    focusRequest: {
      code: null,
      requestId: 0,
      scope: 'scene-test',
      generation: 0,
    },
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
it('preview retires stale selection callbacks and presents hover/fallback locations as text while retaining controls', async () => {
  const props = sceneProps({
    selectionMode: 'preview',
    selectedCode: 'ITC-D01',
    locationNames: { 'ITC-D01': 'Drawer 1' },
    room: {
      ...sceneProps().room,
      nodes: [
        {
          id: 'drawer',
          kind: 'box',
          position: [0, 0, 0],
          rotationZDegrees: 0,
          size: [2, 2, 2],
          locationCode: 'ITC-D01',
          interaction: { selectable: true },
        } as RoomNode,
      ],
    },
  });
  const view = render(<RoomScene {...props} />);
  let select: ((code: string) => void) | undefined;
  let hover: ((hit: unknown) => void) | undefined;
  let unresolved: ((codes: string[]) => void) | undefined;
  const find = (children: ReactNode) =>
    Children.forEach(children, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      if (child.props.node) {
        expect(child.props.selectionEnabled).toBe(false);
        select = child.props.onSelect as typeof select;
      }
      if (child.props.onHit) hover = child.props.onHit as typeof hover;
      if (child.props.onUnresolvedChange)
        unresolved = child.props.onUnresolvedChange as typeof unresolved;
      find(child.props.children as ReactNode);
    });
  find(sceneCanvas.children);
  act(() => {
    select!('ITC-D01');
    hover!({
      target: { code: 'ITC-D01', label: 'Drawer 1' },
      x: 20,
      y: 20,
      width: 200,
      height: 200,
      needsTooltip: true,
    });
    unresolved!(['ITC-D01']);
  });
  expect(props.onSelect).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^Select/ })).toBeNull();
  expect(
    within(
      screen.getByRole('list', {
        name: 'Locations with unavailable room labels',
      }),
    ).queryByRole('button'),
  ).toBeNull();
  expect(document.querySelector('[data-hover-tooltip]')).not.toHaveAttribute(
    'tabindex',
  );
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  view.rerender(
    <RoomScene
      {...props}
      selectionMode="select"
      permittedCodes={['ITC-D01']}
    />,
  );
  act(() => select!('ITC-D01'));
  expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('ITC-D01');
  view.rerender(<RoomScene {...props} />);
  act(() => select!('ITC-D01'));
  expect(props.onSelect).toHaveBeenCalledTimes(1);
});

describe('rendered mesh selection', () => {
  const box = (overrides: Partial<RoomNode> = {}): RoomNode => ({
    id: 'represented-box',
    kind: 'box',
    position: [0, 0, 0],
    rotationZDegrees: 0,
    size: [10, 10, 10],
    locationCode: 'ITC-RED',
    ...overrides,
  });
  const group: RoomNode = {
    id: 'represented-parent',
    kind: 'group',
    position: [0, 0, 0],
    rotationZDegrees: 0,
    locationCode: 'ITC-PARENT',
    children: [box()],
  };

  it.each([null, '', 'OFFICE-ONLY', 'NOT-A-LOCATION', 'ITC-PARENT'])(
    'keeps normal physical colors for %s without a selected rendered box',
    (code) => {
      expect(hasRenderedSelection([group], code, new Set())).toBe(false);
    },
  );
  it('uses actual rendered box bindings, including highlighted represented descendants', () => {
    expect(hasRenderedSelection([group], 'ITC-RED', new Set())).toBe(true);
    expect(
      hasRenderedSelection([group], 'ITC-PARENT', new Set(['ITC-RED'])),
    ).toBe(true);
    expect(
      hasRenderedSelection(
        [group],
        'OFFICE-ONLY',
        new Set(['UNMODELED-CHILD']),
      ),
    ).toBe(false);
    expect(
      hasRenderedSelection([box({ size: undefined })], 'ITC-RED', new Set()),
    ).toBe(false);
  });
  it('preserves logical selection and focus while passing visual availability to the scene nodes', () => {
    const props = sceneProps({
      room: { ...sceneProps().room, nodes: [group] },
      selectedCode: 'OFFICE-ONLY',
      locationNames: { 'OFFICE-ONLY': 'Office storage' },
      focusRequest: {
        code: 'OFFICE-ONLY',
        requestId: 7,
        scope: 'scene-test',
        generation: 1,
      },
    });
    const visualProps = () => {
      const found: Record<string, unknown>[] = [];
      const visit = (children: ReactNode) =>
        Children.forEach(children, (child) => {
          if (!isValidElement<Record<string, unknown>>(child)) return;
          if (child.props.node)
            found.push({
              selectedCode: child.props.selectedCode,
              hasRenderedSelection: child.props.hasRenderedSelection,
            });
          visit(child.props.children as ReactNode);
        });
      visit(sceneCanvas.children);
      return found;
    };
    const view = render(<RoomScene {...props} />);
    expect(visualProps()).toEqual([
      expect.objectContaining({
        selectedCode: 'OFFICE-ONLY',
        hasRenderedSelection: false,
      }),
    ]);
    expect(
      screen
        .getAllByRole('status')
        .find((element) =>
          element.textContent?.startsWith('Selected location:'),
        )!,
    ).toHaveTextContent('Selected location: Office storage (OFFICE-ONLY)');
    const rigProps: Record<string, unknown>[] = [];
    const findRig = (children: ReactNode) =>
      Children.forEach(children, (child) => {
        if (!isValidElement<Record<string, unknown>>(child)) return;
        if (child.props.focusRequest)
          rigProps.push({ focusRequest: child.props.focusRequest });
        findRig(child.props.children as ReactNode);
      });
    findRig(sceneCanvas.children);
    expect(rigProps[0].focusRequest).toBe(props.focusRequest);
    expect(props.onSelect).not.toHaveBeenCalled();
    view.rerender(
      <RoomScene
        {...props}
        selectedCode="ITC-PARENT"
        highlightedCodes={['ITC-RED']}
      />,
    );
    expect(visualProps()).toEqual([
      expect.objectContaining({
        selectedCode: 'ITC-PARENT',
        hasRenderedSelection: true,
      }),
    ]);
  });
});

describe('room scene controls', () => {
  it('Fit, Center selected and Recenter dismiss More without changing logical selection or active interaction', async () => {
    const user = userEvent.setup(),
      props = sceneProps({ selectedCode: 'ITC-S1A', canFocusSelected: true });
    render(<RoomScene {...props} />);
    await user.click(screen.getByRole('button', { name: 'Interact with map' }));
    for (const name of ['Fit room', 'Center selected', 'Recenter']) {
      await user.click(
        screen.getByRole('button', { name: 'More map controls' }),
      );
      await user.click(screen.getByRole('button', { name }));
      expect(
        screen.queryByRole('region', { name: 'More map controls' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: name === 'Recenter' ? 'More map controls' : name,
        }),
      ).toHaveFocus();
      expect(
        screen.getByRole('button', { name: 'Done interacting with map' }),
      ).toHaveAttribute('aria-pressed', 'true');
      expect(
        screen
          .getAllByRole('status')
          .find((element) =>
            element.textContent?.startsWith('Selected location:'),
          ),
      ).toHaveTextContent('ITC-S1A');
      expect(props.onSelect).not.toHaveBeenCalled();
    }
    expect(props.onRequestFocus).toHaveBeenCalledOnce();
  });
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
    await user.click(screen.getByRole('button', { name: 'More map controls' }));
    const toggle = screen.getByRole('button', { name: 'Show labels' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
    expect(
      screen
        .getAllByRole('status')
        .find((element) =>
          element.textContent?.startsWith('Selected location:'),
        )!,
    ).toHaveTextContent('Selected location: Shelf 1A (ITC-S1A)');
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

  it.each(['Pan left', 'Controls'])(
    'Escape from %s restores Interact and preserves selection',
    async (control) => {
      const user = userEvent.setup();
      const props = sceneProps({ selectedCode: 'ITC-S1A' });
      render(<RoomScene {...props} />);
      await user.click(
        screen.getByRole('button', { name: 'Interact with map' }),
      );
      const more = screen.getByRole('button', { name: 'More map controls' });
      await user.click(more);
      const panel = screen.getByRole('region', { name: 'More map controls' });
      expect(
        within(panel).queryByRole('button', { name: /interacting with map/ }),
      ).toBeNull();
      await user.click(within(panel).getByRole('button', { name: control }));
      await user.keyboard('{Escape}');
      const interact = screen.getByRole('button', {
        name: 'Interact with map',
      });
      expect(interact).toHaveFocus();
      expect(interact).toHaveAttribute('aria-pressed', 'false');
      expect(more).toHaveAttribute('aria-expanded', 'false');
      expect(
        screen.getByText('Map interaction off. Scroll moves the page.'),
      ).toHaveAttribute('role', 'status');
      expect(screen.getByText(/Selected location: ITC-S1A/)).toBeVisible();
      expect(props.onSelect).not.toHaveBeenCalled();
      await user.tab();
      expect(more).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(screen.getByRole('button', { name: 'Controls' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    },
  );

  it('keeps instructions short and restores focus after complete controls help', async () => {
    const user = userEvent.setup();
    render(<RoomScene {...sceneProps()} />);
    const more = screen.getByRole('button', { name: 'More map controls' });
    await user.click(more);
    await user.click(screen.getByRole('button', { name: /^Controls$/ }));
    expect(
      screen.getByText(/Counts mark occupied visible locations/),
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

it('offers unresolved room locations as native keyboard/touch actions and retries both shared transactions', async () => {
  const props = sceneProps({
    selectedCode: 'ITC-S1A',
    locationNames: { 'ITC-S1A': 'Adapters shelf', 'ITC-D01': 'Spare adapters' },
  });
  const user = userEvent.setup();
  render(<RoomScene {...props} />);
  let notify: ((codes: string[]) => void) | undefined;
  let retryRef: { current: (() => void) | null } | undefined;
  let registry: RoomLabelRegistry | undefined;
  const find = (children: ReactNode) =>
    Children.forEach(children, (child) => {
      if (!isValidElement<Record<string, unknown>>(child)) return;
      if (child.props.onUnresolvedChange) {
        notify = child.props.onUnresolvedChange as typeof notify;
        retryRef = child.props.retryRef as typeof retryRef;
      }
      if (child.props.registry)
        registry = child.props.registry as RoomLabelRegistry;
      find(child.props.children as ReactNode);
    });
  find(sceneCanvas.children);
  const retryVisibility = vi.fn(),
    retryPlacement = vi.spyOn(registry!, 'retry');
  retryRef!.current = retryVisibility;
  act(() => notify!(['ITC-S1A', 'ITC-D01', 'ITC-S1A']));
  expect(
    screen.getByText(/Some room labels could not be checked or placed/),
  ).toHaveAttribute('role', 'status');
  const actions = within(
    screen.getByRole('list', {
      name: 'Locations with unavailable room labels',
    }),
  );
  expect(actions.getAllByRole('button')).toHaveLength(2);
  const selected = actions.getByRole('button', { name: 'Adapters shelf' });
  expect(selected).toHaveAttribute('aria-pressed', 'true');
  selected.focus();
  await user.keyboard('{Enter}');
  expect(props.onSelect).toHaveBeenLastCalledWith('ITC-S1A');
  await user.pointer([
    {
      keys: '[TouchA>]',
      target: actions.getByRole('button', { name: 'Spare adapters' }),
    },
    { keys: '[/TouchA]' },
  ]);
  expect(props.onSelect).toHaveBeenLastCalledWith('ITC-D01');
  await user.click(
    screen.getByRole('button', { name: 'Retry label placement' }),
  );
  expect(retryVisibility).toHaveBeenCalledOnce();
  expect(retryPlacement).toHaveBeenCalledOnce();
  act(() => notify!([]));
  expect(
    screen.queryByRole('list', {
      name: 'Locations with unavailable room labels',
    }),
  ).toBeNull();
});

it.each([{ permittedCodes: [] }, { selectionAllowed: () => false }])(
  'renders ineligible destinations as text across labels, tooltip and fallback: %o',
  (exclusion) => {
    const props = sceneProps({
      ...exclusion,
      locationNames: { 'ITC-D01': 'Drawer 1' },
      room: {
        ...sceneProps().room,
        nodes: [
          {
            id: 'drawer',
            kind: 'box',
            position: [0, 0, 0],
            rotationZDegrees: 0,
            size: [2, 2, 2],
            locationCode: 'ITC-D01',
            interaction: { selectable: true },
          } as RoomNode,
        ],
      },
    });
    const view = render(<RoomScene {...props} />);
    let hover!: (hit: unknown) => void;
    let unresolved!: (codes: string[]) => void;
    let select!: (code: string) => void;
    const find = (children: ReactNode) =>
      Children.forEach(children, (child) => {
        if (!isValidElement<Record<string, unknown>>(child)) return;
        if (child.props.node) {
          expect(
            (child.props.selectionAvailable as (code: string) => boolean)(
              'ITC-D01',
            ),
          ).toBe(false);
          select = child.props.onSelect as typeof select;
        }
        if (child.props.onHit) hover = child.props.onHit as typeof hover;
        if (child.props.onUnresolvedChange)
          unresolved = child.props.onUnresolvedChange as typeof unresolved;
        find(child.props.children as ReactNode);
      });
    find(sceneCanvas.children);
    act(() => {
      hover({
        target: { code: 'ITC-D01', label: 'Drawer 1' },
        x: 20,
        y: 20,
        width: 200,
        height: 200,
        needsTooltip: true,
      });
      unresolved(['ITC-D01']);
      select('ITC-D01');
    });
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Select/ })).toBeNull();
    expect(
      within(
        screen.getByRole('list', {
          name: 'Locations with unavailable room labels',
        }),
      ).queryByRole('button'),
    ).toBeNull();
    view.rerender(
      <RoomScene
        {...props}
        permittedCodes={['ITC-D01']}
        selectionAllowed={() => true}
      />,
    );
    expect(
      screen.getByRole('button', { name: /^Select Drawer 1/ }),
    ).toBeEnabled();
    act(() => select('ITC-D01'));
    expect(props.onSelect).toHaveBeenCalledExactlyOnceWith('ITC-D01');
  },
);
