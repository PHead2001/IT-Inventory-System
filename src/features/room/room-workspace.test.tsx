import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Suspense, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectedLocations } from '../../../tests/fixtures/reference';
import type { LocationRef } from '../inventory/contracts-ui';
import type { RoomSceneProps } from './scene/room-scene';
import { loadItCloset } from './load';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  sceneProps: null as RoomSceneProps | null,
  throwScene: false,
  autoReady: true,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('next/dynamic', () => ({
  default: () =>
    function TestScene(props: RoomSceneProps) {
      mocks.sceneProps = props;
      const { onReady } = props;
      useEffect(() => {
        if (mocks.autoReady) onReady();
      }, [onReady]);
      if (mocks.throwScene) throw new Error('Test renderer failed');
      return (
        <div data-testid="scene-contract">
          <button onClick={() => props.onSelect('ITC-D01')}>
            Select drawer in scene
          </button>
          <button onClick={() => props.onSelect('UNKNOWN')}>
            Emit unknown location
          </button>
          <button
            disabled={!props.canFocusSelected}
            onClick={props.onRequestFocus}
          >
            Center selected
          </button>
          <button
            onClick={() => props.onFocusComplete(props.focusRequest.code)}
          >
            Finish camera focus
          </button>
          <button onClick={() => props.onFailure('WebGL context was lost.')}>
            Simulate WebGL failure
          </button>
        </div>
      );
    },
}));
import { RoomWorkspace } from './room-workspace';

const room = loadItCloset();
const locations: LocationRef[] = expectedLocations.map(
  ([code, name, parentCode, , capable]) => ({
    id: 'uuid-' + code,
    code,
    name,
    breadcrumb: 'IT Closet / ' + name,
    active: true,
    can_hold_inventory: capable,
    parentId: parentCode ? 'uuid-' + parentCode : null,
  }),
);
function workspace(code: string | null, refs = locations) {
  return (
    <RoomWorkspace room={room} locations={refs} selectedCode={code}>
      <p>
        {code
          ? 'Server inventory for ' + code
          : 'Choose a location to browse inventory'}
      </p>
    </RoomWorkspace>
  );
}
async function choose(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(screen.getByLabelText('Select location'));
  await user.type(
    screen.getByRole('combobox', { name: 'Search locations' }),
    code,
  );
  await user.click(screen.getByRole('option', { name: new RegExp(code) }));
}
function expectPicker(code: string) {
  expect(screen.getByLabelText('Select location')).toHaveTextContent(code);
}
function PendingNavigation({ read }: { read: () => void }) {
  const [code, setCode] = useState('ITC-S1A');
  mocks.push.mockImplementation(() => {
    setCode('ITC-D01');
  });
  if (code === 'ITC-D01') read();
  return workspace(code);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.push.mockReset();
  mocks.sceneProps = null;
  mocks.throwScene = false;
  mocks.autoReady = true;
});

describe('room application and scene contract', () => {
  it('keeps scene, picker and server panel on one authoritative selection while navigation is pending', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const navigation = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let ready = false;
    render(
      <Suspense fallback={<p>Loading selected location</p>}>
        <PendingNavigation
          read={() => {
            if (!ready) throw navigation;
          }}
        />
      </Suspense>,
    );
    await choose(user, 'ITC-D01');
    expect(mocks.push).toHaveBeenCalledWith('/room?location=ITC-D01', {
      scroll: false,
    });
    expect(
      screen.getByRole('region', { name: 'Location inventory' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Server inventory for ITC-S1A')).toBeVisible();
    expectPicker('ITC-S1A');
    expect(mocks.sceneProps?.selectedCode).toBe('ITC-S1A');
    expect(mocks.sceneProps?.canFocusSelected).toBe(false);
    expect(screen.getByLabelText('Select location')).toBeDisabled();
    await act(async () => {
      ready = true;
      finish();
      await navigation;
    });
    expect(screen.getByText('Server inventory for ITC-D01')).toBeVisible();
    expectPicker('ITC-D01');
    expect(mocks.sceneProps?.selectedCode).toBe('ITC-D01');
    expect(mocks.sceneProps?.focusRequest.code).toBe('ITC-D01');
    expect(mocks.sceneProps?.canFocusSelected).toBe(true);
  });

  it('preserves geometry references across equivalent RSC objects while accepting changed geometry and selection', () => {
    const renderRoom = (geometry: typeof room, code: string) => (
      <RoomWorkspace room={geometry} locations={locations} selectedCode={code}>
        <p>{'Server inventory for ' + code}</p>
      </RoomWorkspace>
    );
    const view = render(renderRoom(room, 'ITC-S1A'));
    const firstRoom = mocks.sceneProps!.room;
    const firstBindings = mocks.sceneProps!.bindings;
    view.rerender(renderRoom(structuredClone(room), 'ITC-D01'));
    expect(mocks.sceneProps!.room).toBe(firstRoom);
    expect(mocks.sceneProps!.bindings).toBe(firstBindings);
    expect(mocks.sceneProps!.selectedCode).toBe('ITC-D01');
    expect(mocks.sceneProps!.focusRequest.code).toBe('ITC-D01');
    expectPicker('ITC-D01');
    expect(screen.getByText('Server inventory for ITC-D01')).toBeVisible();
    const changed = structuredClone(room);
    changed.camera.azimuthDegrees =
      room.camera.azimuthDegrees === room.camera.azimuthLimitsDegrees[0]
        ? room.camera.azimuthDegrees + 1
        : room.camera.azimuthDegrees - 1;
    view.rerender(renderRoom(changed, 'ITC-D01'));
    expect(mocks.sceneProps!.room).not.toBe(firstRoom);
    expect(mocks.sceneProps!.bindings).not.toBe(firstBindings);
    expect(mocks.sceneProps!.room.camera.azimuthDegrees).toBe(
      changed.camera.azimuthDegrees,
    );
    expect(mocks.sceneProps!.selectedCode).toBe('ITC-D01');
  });

  it('scene selection navigates by stable code and changes only when route props arrive', async () => {
    const user = userEvent.setup();
    const view = render(workspace('ITC-S1A'));
    await user.click(
      screen.getByRole('button', { name: 'Select drawer in scene' }),
    );
    expect(mocks.push).toHaveBeenCalledWith('/room?location=ITC-D01', {
      scroll: false,
    });
    expectPicker('ITC-S1A');
    view.rerender(workspace('ITC-D01'));
    expectPicker('ITC-D01');
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-selected-code',
      'ITC-D01',
    );
    mocks.push.mockClear();
    await user.click(
      screen.getByRole('button', { name: 'Emit unknown location' }),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('retains aggregate selection and highlights database inventory descendants', () => {
    render(workspace('ITC-L'));
    expectPicker('ITC-L');
    expect(mocks.sceneProps?.selectedCode).toBe('ITC-L');
    expect(mocks.sceneProps?.highlightedCodes).toHaveLength(12);
    expect(mocks.sceneProps?.highlightedCodes).toContain('ITC-D06');
    expect(mocks.sceneProps?.highlightedCodes).not.toContain('ITC-RED');
    expect(mocks.sceneProps?.highlightedCodes).not.toContain('ITC-L');
    expect(screen.getByText('Server inventory for ITC-L')).toBeVisible();
  });

  it('requests another camera focus for the same selection without clearing persistent selection', async () => {
    const user = userEvent.setup();
    render(workspace('ITC-D01'));
    await user.click(
      screen.getByRole('button', { name: 'Finish camera focus' }),
    );
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      'ITC-D01',
    );
    const first = mocks.sceneProps!.focusRequest.requestId;
    await user.click(screen.getByRole('button', { name: 'Center selected' }));
    expect(mocks.sceneProps?.focusRequest.requestId).toBeGreaterThan(first);
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      '',
    );
    expect(mocks.sceneProps?.selectedCode).toBe('ITC-D01');
    await user.click(
      screen.getByRole('button', { name: 'Finish camera focus' }),
    );
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      'ITC-D01',
    );
    const second = mocks.sceneProps!.focusRequest.requestId;
    await user.click(
      screen.getByRole('button', { name: 'Select drawer in scene' }),
    );
    expect(mocks.sceneProps?.focusRequest.requestId).toBeGreaterThan(second);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.getByText('Server inventory for ITC-D01')).toBeVisible();
  });

  it('reflects browser route changes and clear selection without an independent optimistic store', async () => {
    const user = userEvent.setup();
    const view = render(workspace('ITC-S1A'));
    view.rerender(workspace('ITC-D12'));
    expect(mocks.sceneProps?.selectedCode).toBe('ITC-D12');
    expectPicker('ITC-D12');
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(mocks.push).toHaveBeenCalledWith('/room', { scroll: false });
    expect(screen.getByText('Server inventory for ITC-D12')).toBeVisible();
    view.rerender(workspace(null));
    expect(mocks.sceneProps?.selectedCode).toBeNull();
    expect(mocks.sceneProps?.highlightedCodes).toEqual([]);
    expect(
      screen.getByRole('button', { name: 'Center selected' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Clear selection' }),
    ).toBeDisabled();
    expect(screen.getByText('No location selected.')).toBeVisible();
  });

  it('keeps a valid unmodeled logical location usable and explains the missing room binding', () => {
    const external = {
      ...locations[0],
      id: 'external',
      code: 'ITC-EXTERNAL',
      name: 'External',
      breadcrumb: 'External location',
    };
    render(workspace(external.code, [...locations, external]));
    expectPicker(external.code);
    expect(screen.getByText(/No modeled location is available/)).toBeVisible();
    expect(screen.getByText('Server inventory for ITC-EXTERNAL')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Center selected' }),
    ).toBeDisabled();
    expect(mocks.sceneProps?.focusRequest.code).toBeNull();
    expect(mocks.sceneProps?.canFocusSelected).toBe(false);
  });

  it('handles an unknown deep-link code without inventing a selection or disabling conventional search', () => {
    render(workspace('UNKNOWN'));
    expectPicker('UNKNOWN');
    expect(screen.getByText(/No modeled location is available/)).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Search inventory' }),
    ).toHaveAttribute('href', '/inventory');
    expect(mocks.sceneProps?.focusRequest.code).toBeNull();
  });

  it('keeps picker and inventory usable after a WebGL context failure', async () => {
    const user = userEvent.setup();
    render(workspace('ITC-S1A'));
    await user.click(
      screen.getByRole('button', { name: 'Simulate WebGL failure' }),
    );
    expect(
      screen.getByRole('heading', { name: 'Room view unavailable' }),
    ).toBeVisible();
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-state',
      'failed',
    );
    expect(screen.queryByTestId('scene-contract')).not.toBeInTheDocument();
    expect(screen.getByText('Server inventory for ITC-S1A')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Center selected' }),
    ).not.toBeInTheDocument();
    await choose(user, 'ITC-D01');
    expect(mocks.push).toHaveBeenCalledWith('/room?location=ITC-D01', {
      scroll: false,
    });
  });

  it('retries a failed renderer without discarding selected inventory and waits for new readiness', async () => {
    const user = userEvent.setup();
    render(workspace('ITC-S1A'));
    await user.click(
      screen.getByRole('button', { name: 'Simulate WebGL failure' }),
    );
    mocks.autoReady = false;
    await user.click(screen.getByRole('button', { name: 'Retry room' }));
    expect(
      screen.queryByRole('heading', { name: 'Room view unavailable' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('scene-contract')).toBeVisible();
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-state',
      'loading',
    );
    expectPicker('ITC-S1A');
    expect(screen.getByText('Server inventory for ITC-S1A')).toBeVisible();
    act(() => mocks.sceneProps!.onReady());
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-state',
      'ready',
    );
  });

  it('contains renderer initialization exceptions in the scene boundary', () => {
    mocks.throwScene = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(workspace('ITC-S1A'));
      expect(
        screen.getByRole('heading', { name: 'Room view unavailable' }),
      ).toBeVisible();
      expect(screen.getByText('Server inventory for ITC-S1A')).toBeVisible();
      expect(screen.getByLabelText('Select location')).toBeEnabled();
    } finally {
      error.mockRestore();
    }
  });

  it('resets readiness and completed focus until a reopened scene reports its new readiness', async () => {
    const user = userEvent.setup();
    render(workspace('ITC-D01'));
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await user.click(
      screen.getByRole('button', { name: 'Finish camera focus' }),
    );
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      'ITC-D01',
    );
    await user.click(screen.getByRole('button', { name: 'Hide room' }));
    mocks.autoReady = false;
    await user.click(screen.getByRole('button', { name: 'Show room' }));
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-state',
      'loading',
    );
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      '',
    );
    expectPicker('ITC-D01');
    expect(screen.getByText('Server inventory for ITC-D01')).toBeVisible();
    act(() => mocks.sceneProps!.onReady());
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await user.click(
      screen.getByRole('button', { name: 'Finish camera focus' }),
    );
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-focused-code',
      'ITC-D01',
    );
  });

  it('can hide and reopen the optional scene without losing logical selection or the inventory panel', async () => {
    const user = userEvent.setup();
    render(workspace('ITC-D01'));
    await user.click(screen.getByRole('button', { name: 'Hide room' }));
    expect(screen.queryByTestId('room-viewer')).not.toBeInTheDocument();
    expectPicker('ITC-D01');
    expect(screen.getByText('Server inventory for ITC-D01')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Show room' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await user.click(screen.getByRole('button', { name: 'Show room' }));
    expect(screen.getByTestId('room-viewer')).toHaveAttribute(
      'data-selected-code',
      'ITC-D01',
    );
    expect(mocks.sceneProps?.focusRequest.code).toBe('ITC-D01');
  });
});
