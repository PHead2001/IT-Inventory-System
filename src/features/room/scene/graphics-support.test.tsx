import { act, render, waitFor } from '@testing-library/react';
import { Children, isValidElement, StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeCanvas, GraphicsBoundary } from './safe-canvas';
import {
  RoomSceneBudgetProvider,
  ScenePriorityContext,
} from './scene-budget-provider';
import { revokePrivatePresentation } from '@/features/scan/assign-batch';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
const driver = vi.hoisted(() => ({
  configure: vi.fn(),
  render: vi.fn(),
  unmount: vi.fn(),
  create: vi.fn(),
  teardown: vi.fn(),
  authority: null as import('./camera-snapshot-store').CameraAuthority | null,
}));
vi.mock('./camera-snapshot-provider', () => ({
  useRoomSceneAuthority: () => driver.authority,
}));
vi.mock('@react-three/fiber', () => ({
  createRoot: driver.create,
  events: vi.fn(),
  extend: vi.fn(),
  unmountComponentAtNode: driver.teardown,
}));
beforeEach(() => {
  vi.clearAllMocks();
  driver.authority = null;
  driver.configure.mockResolvedValue(undefined);
  driver.create.mockReturnValue(driver);
  driver.render.mockReturnValue({
    getState: () => ({ scene: {} }),
    setState: vi.fn(),
  });
  driver.teardown.mockImplementation((_canvas, complete) => complete());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 600,
    height: 400,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 600,
    bottom: 400,
    toJSON() {},
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('keeps canvas fallback markup inert while configuring the actual renderer', async () => {
  const onFailure = vi.fn();
  const { container } = render(
    <SafeCanvas onFailure={onFailure} fallback="Graphics unavailable">
      scene
    </SafeCanvas>,
  );
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(container.querySelector('canvas')?.textContent).toBe(
    'Graphics unavailable',
  );
  expect(onFailure).not.toHaveBeenCalled();
  expect(driver.configure).toHaveBeenCalledOnce();
});
it('handles the actual configure rejection locally without rendering or claiming readiness', async () => {
  driver.configure.mockRejectedValue(new Error('Renderer construction failed'));
  const onFailure = vi.fn();
  render(<SafeCanvas onFailure={onFailure}>scene</SafeCanvas>);
  await waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
  expect(driver.render).toHaveBeenCalledWith(null);
  expect(driver.teardown).toHaveBeenCalledOnce();
});
it('ignores late initialization after unmount and disposes the graphics root', async () => {
  let finish!: (value: unknown) => void;
  driver.configure.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onFailure = vi.fn();
  const view = render(<SafeCanvas onFailure={onFailure}>scene</SafeCanvas>);
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  view.unmount();
  await act(async () => finish(undefined));
  expect(driver.render).not.toHaveBeenCalled();
  expect(driver.teardown).toHaveBeenCalledOnce();
  expect(onFailure).not.toHaveBeenCalled();
});
it('does not allocate a root for the provisional StrictMode mount', async () => {
  render(
    <StrictMode>
      <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>
    </StrictMode>,
  );
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(driver.create).toHaveBeenCalledOnce();
});
it('uses ordinary public teardown for an error after successful configure without rendering null', async () => {
  driver.render.mockImplementation(() => {
    throw new Error('post-configure render failure');
  });
  const failure = vi.fn();
  render(<SafeCanvas onFailure={failure}>scene</SafeCanvas>);
  await waitFor(() => expect(failure).toHaveBeenCalledOnce());
  expect(driver.teardown).toHaveBeenCalledOnce();
  expect(driver.render).toHaveBeenCalledOnce();
  expect(driver.render).not.toHaveBeenCalledWith(null);
});
it('keeps the original session callback and context value stable across same-owner renders', async () => {
  const ui = (label: string) => (
    <SafeCanvas onFailure={vi.fn()}>{label}</SafeCanvas>
  );
  const view = render(ui('first'));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  const context = (children: ReactNode) => {
    let result: { current(): boolean } | undefined;
    const visit = (nodes: ReactNode) =>
      Children.forEach(nodes, (node) => {
        if (!isValidElement<Record<string, unknown>>(node)) return;
        const value = node.props.value as { current?: unknown } | undefined;
        if (typeof value?.current === 'function')
          result = value as { current(): boolean };
        visit(node.props.children as ReactNode);
      });
    visit(children);
    return result;
  };
  const original = context(driver.render.mock.calls[0][0]);
  expect(original?.current()).toBe(true);
  view.rerender(ui('second'));
  await waitFor(() => expect(driver.render).toHaveBeenCalledTimes(2));
  const updated = context(driver.render.mock.calls[1][0]);
  expect(updated).toBe(original);
  expect(updated?.current).toBe(original?.current);
  expect(driver.create).toHaveBeenCalledOnce();
  expect(driver.teardown).not.toHaveBeenCalled();
});
it.each(['actor', 'backend', 'generation'])(
  'permanently retires committed %s drift while ordinary verification can resume the original session',
  async (field) => {
    const authority = {
      actorId: 'actor-a',
      backend: 'https://backend.example',
      generation: 'verified',
      revision: readPrivacyRevocationRevision(),
      epoch: assignmentEpoch(),
    };
    driver.authority = authority;
    const failure = vi.fn();
    const ui = (ready = true, generation = 'verified') => (
      <PrivacyReadinessContext
        value={{
          ready,
          visible: ready,
          generation,
          revocationRevision: authority.revision,
          verifiedEpoch: authority.epoch,
        }}
      >
        <SafeCanvas onFailure={failure}>private scene</SafeCanvas>
      </PrivacyReadinessContext>
    );
    const view = render(ui());
    await waitFor(() => expect(driver.create).toHaveBeenCalledOnce());
    view.rerender(ui(false));
    await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
    view.rerender(ui());
    await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
    driver.authority = {
      ...authority,
      ...(field === 'actor'
        ? { actorId: 'actor-b' }
        : field === 'backend'
          ? { backend: 'https://other.example' }
          : { generation: 'other' }),
    };
    view.rerender(ui(true, field === 'generation' ? 'other' : 'verified'));
    await waitFor(() => expect(driver.teardown).toHaveBeenCalledTimes(2));
    driver.authority = authority;
    view.rerender(ui());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(driver.create).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
  },
);

it('priority preemption retains the disposing slot and Resume map allocates again after the picker closes', async () => {
  let finish!: () => void;
  driver.teardown.mockImplementation((_canvas, complete) => {
    finish = complete;
  });
  const failure = vi.fn();
  const ui = (picker: boolean) => (
    <RoomSceneBudgetProvider>
      <ScenePriorityContext value={0}>
        <SafeCanvas onFailure={failure}>preview</SafeCanvas>
      </ScenePriorityContext>
      {picker && (
        <ScenePriorityContext value={2}>
          <SafeCanvas onFailure={failure}>picker</SafeCanvas>
        </ScenePriorityContext>
      )}
    </RoomSceneBudgetProvider>
  );
  const view = render(ui(false));
  await waitFor(() => expect(driver.create).toHaveBeenCalledOnce());
  view.rerender(ui(true));
  await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
  expect(driver.create).toHaveBeenCalledOnce();
  act(() => finish());
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
  view.rerender(ui(false));
  await waitFor(() => expect(driver.teardown).toHaveBeenCalledTimes(2));
  act(() => finish());
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Resume map' }));
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(3));
});

it('rejects pending initialization after committed authority A/B/A without relying on global invalidation', async () => {
  const authority = {
    actorId: 'actor-a',
    backend: 'https://backend.example',
    generation: 'verified',
    revision: readPrivacyRevocationRevision(),
    epoch: assignmentEpoch(),
  };
  driver.authority = authority;
  let finish!: (value: unknown) => void;
  driver.configure.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const failure = vi.fn();
  const ui = () => (
    <PrivacyReadinessContext
      value={{
        ready: true,
        generation: 'verified',
        revocationRevision: authority.revision,
        verifiedEpoch: authority.epoch,
      }}
    >
      <SafeCanvas onFailure={failure}>private scene</SafeCanvas>
    </PrivacyReadinessContext>
  );
  const view = render(ui());
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  driver.authority = { ...authority, actorId: 'actor-b' };
  view.rerender(ui());
  driver.authority = authority;
  view.rerender(ui());
  expect(view.container.firstElementChild).toHaveAttribute('hidden');
  expect(view.container.firstElementChild).toHaveAttribute('inert');
  await act(async () => finish(undefined));
  expect(driver.render).not.toHaveBeenCalled();
  expect(driver.teardown).toHaveBeenCalledOnce();
  expect(driver.create).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
});

it('revocation masks synchronously and late initialization cannot publish private children or grant another scene early', async () => {
  let configure!: (value: unknown) => void;
  driver.configure.mockImplementation(
    () =>
      new Promise((resolve) => {
        configure = resolve;
      }),
  );
  const failure = vi.fn();
  const view = render(
    <SafeCanvas onFailure={failure}>private scene</SafeCanvas>,
  );
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  const host = view.container.firstElementChild!;
  act(() => {
    revokePrivatePresentation();
    expect(host).toHaveAttribute('hidden');
    expect(host).toHaveAttribute('inert');
  });
  await act(async () => configure(undefined));
  expect(driver.render).not.toHaveBeenCalled();
  expect(driver.teardown).toHaveBeenCalledOnce();
  expect(failure).not.toHaveBeenCalled();
});
it('reports child scene errors from the separate graphics React root', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  function Broken(): never {
    throw new Error('Scene failure');
  }
  const onFailure = vi.fn();
  render(
    <GraphicsBoundary onFailure={onFailure}>
      <Broken />
    </GraphicsBoundary>,
  );
  expect(onFailure).toHaveBeenCalledOnce();
});

it('connects pointer events to the host so Html portals stay outside canvas fallback content', async () => {
  const { container } = render(
    <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>,
  );
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  const connect = vi.fn();
  driver.configure.mock.calls[0][0].onCreated({ events: { connect } });
  expect(connect).toHaveBeenCalledWith(
    container.querySelector('canvas')?.parentElement,
  );
  expect(connect).not.toHaveBeenCalledWith(container.querySelector('canvas'));
});
