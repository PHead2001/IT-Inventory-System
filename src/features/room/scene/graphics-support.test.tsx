import { renderToString } from 'react-dom/server';
import { act, render, waitFor } from '@testing-library/react';
import {
  Children,
  isValidElement,
  StrictMode,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SafeCanvas, GraphicsBoundary } from './safe-canvas';
import {
  RoomSceneBudgetProvider,
  ScenePriorityContext,
  SceneSessionContext,
} from './scene-budget-provider';
import { revokePrivatePresentation } from '@/features/scan/assign-batch';
import {
  assignmentEpoch,
  invalidateAssignmentCallbacks,
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
function verifiedOwner() {
  const authority = {
    actorId: 'actor-a',
    backend: 'https://backend.example',
    generation: 'verified',
    revision: readPrivacyRevocationRevision(),
    epoch: assignmentEpoch(),
  };
  driver.authority = authority;
  return (ready: boolean) => ({
    ready,
    visible: true,
    generation: authority.generation,
    revocationRevision: authority.revision,
    verifiedEpoch: ready ? authority.epoch : undefined,
  });
}
function contextValue<T>(tree: ReactNode, context: unknown): T | undefined {
  let result: T | undefined;
  const visit = (nodes: ReactNode) =>
    Children.forEach(nodes, (node) => {
      if (!isValidElement<{ value?: T; children?: ReactNode }>(node)) return;
      if (node.type === context) result = node.props.value;
      visit(node.props.children);
    });
  visit(tree);
  return result;
}
it('treats a queued grant between committed withholding and passive cleanup as pending admission, then resumes fresh automatically', async () => {
  const privacy = verifiedOwner();
  let complete!: () => void;
  driver.teardown.mockImplementation((_canvas, callback) => {
    complete = callback;
  });
  function Release({ release }: { release: boolean }) {
    useLayoutEffect(() => {
      if (release) complete();
    }, [release]);
    return null;
  }
  const ui = (occupied: boolean, ready: boolean, release = false) => (
    <PrivacyReadinessContext value={privacy(ready)}>
      <RoomSceneBudgetProvider>
        {occupied && (
          <ScenePriorityContext value={1}>
            <SafeCanvas onFailure={vi.fn()}>occupied</SafeCanvas>
          </ScenePriorityContext>
        )}
        <ScenePriorityContext value={0}>
          <SafeCanvas onFailure={vi.fn()}>queued</SafeCanvas>
        </ScenePriorityContext>
        <Release release={release} />
      </RoomSceneBudgetProvider>
    </PrivacyReadinessContext>
  );
  const view = render(ui(true, true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  view.rerender(ui(false, true));
  await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
  view.rerender(ui(false, false, true));
  expect(driver.create).toHaveBeenCalledOnce();
  view.rerender(ui(false, true));
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'Resume map' })).toBeNull();
});
it('retains the allocated canvas and original session while propagating withheld current privacy', async () => {
  const privacy = verifiedOwner();
  const ui = (ready: boolean) => (
    <PrivacyReadinessContext value={privacy(ready)}>
      <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>
    </PrivacyReadinessContext>
  );
  const view = render(ui(true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  const canvas = view.container.querySelector('canvas');
  const session = contextValue<{ current(): boolean }>(
    driver.render.mock.calls[0][0],
    SceneSessionContext,
  );
  view.rerender(ui(false));
  await waitFor(() => expect(driver.render).toHaveBeenCalledTimes(2));
  expect(view.container.querySelector('canvas')).toBe(canvas);
  expect(view.container.firstElementChild).not.toHaveAttribute('hidden');
  expect(
    contextValue(driver.render.mock.calls.at(-1)![0], PrivacyReadinessContext),
  ).toEqual(privacy(false));
  expect(
    contextValue(driver.render.mock.calls.at(-1)![0], SceneSessionContext),
  ).toBe(session);
  expect(session?.current()).toBe(true);
  view.rerender(ui(true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledTimes(3));
  expect(driver.create).toHaveBeenCalledOnce();
  expect(driver.configure).toHaveBeenCalledOnce();
  expect(driver.teardown).not.toHaveBeenCalled();
});
it('preserves mounted child state in the separate renderer root through a visible recheck', async () => {
  const privacy = verifiedOwner();
  const scene = render(<></>);
  driver.render.mockImplementation((tree: ReactNode) =>
    scene.rerender(<>{tree}</>),
  );
  driver.teardown.mockImplementation((_canvas, complete) => {
    scene.unmount();
    complete();
  });
  let incarnation = 0;
  const mount = vi.fn();
  const unmount = vi.fn();
  function Child() {
    const [id] = useState(() => ++incarnation);
    const currentPrivacy = useContext(PrivacyReadinessContext);
    useEffect(() => {
      mount();
      return unmount;
    }, []);
    return (
      <output data-testid="scene-owner">
        {id}:{currentPrivacy.ready ? 'fresh' : 'withheld'}
      </output>
    );
  }
  const onLeaseChange = vi.fn();
  const ui = (ready: boolean) => (
    <PrivacyReadinessContext value={privacy(ready)}>
      <SafeCanvas onFailure={vi.fn()} onLeaseChange={onLeaseChange}>
        <Child />
      </SafeCanvas>
    </PrivacyReadinessContext>
  );
  const view = render(ui(true));
  await waitFor(() =>
    expect(screen.getByTestId('scene-owner')).toHaveTextContent('1:fresh'),
  );
  const child = screen.getByTestId('scene-owner');
  view.rerender(ui(false));
  await waitFor(() => expect(child).toHaveTextContent('1:withheld'));
  view.rerender(ui(true));
  await waitFor(() => expect(child).toHaveTextContent('1:fresh'));
  expect(screen.getByTestId('scene-owner')).toBe(child);
  expect(mount).toHaveBeenCalledOnce();
  expect(unmount).not.toHaveBeenCalled();
  expect(onLeaseChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(driver.create).toHaveBeenCalledOnce();
  expect(driver.teardown).not.toHaveBeenCalled();
  view.unmount();
  expect(unmount).toHaveBeenCalledOnce();
});
it('retains pending configure without first scene mount while withheld and resumes at unchanged dimensions', async () => {
  const privacy = verifiedOwner();
  let finish!: (value: unknown) => void;
  driver.configure.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const ui = (ready: boolean) => (
    <PrivacyReadinessContext value={privacy(ready)}>
      <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>
    </PrivacyReadinessContext>
  );
  const view = render(ui(true));
  await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
  const canvas = view.container.querySelector('canvas');
  view.rerender(ui(false));
  await act(async () => finish(undefined));
  expect(driver.render).not.toHaveBeenCalled();
  expect(driver.teardown).not.toHaveBeenCalled();
  expect(view.container.querySelector('canvas')).toBe(canvas);
  view.rerender(ui(true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(driver.create).toHaveBeenCalledOnce();
  expect(driver.configure).toHaveBeenCalledOnce();
});
it('cancels withheld queued admission and waits for fresh verification after the occupied slot completes', async () => {
  const privacy = verifiedOwner();
  let complete!: () => void;
  driver.teardown.mockImplementation((_canvas, done) => {
    complete = done;
  });
  const ui = (primary: boolean, ready: boolean) => (
    <RoomSceneBudgetProvider>
      {primary && (
        <ScenePriorityContext value={2}>
          <SafeCanvas onFailure={vi.fn()}>primary</SafeCanvas>
        </ScenePriorityContext>
      )}
      <PrivacyReadinessContext value={privacy(ready)}>
        <ScenePriorityContext value={0}>
          <SafeCanvas onFailure={vi.fn()}>queued</SafeCanvas>
        </ScenePriorityContext>
      </PrivacyReadinessContext>
    </RoomSceneBudgetProvider>
  );
  const view = render(ui(true, true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  view.rerender(ui(false, false));
  await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
  act(() => complete());
  await act(async () => {});
  expect(driver.create).toHaveBeenCalledOnce();
  view.rerender(ui(false, true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledTimes(2));
  expect(driver.create).toHaveBeenCalledTimes(2);
});
it('withdraws admitted but unallocated work before the deferred frame and resumes only with a fresh grant', async () => {
  const privacy = verifiedOwner();
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const ui = (ready: boolean) => (
    <PrivacyReadinessContext value={privacy(ready)}>
      <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>
    </PrivacyReadinessContext>
  );
  const view = render(ui(true));
  expect(frames).toHaveLength(1);
  view.rerender(ui(false));
  await act(async () => frames[0](0));
  expect(driver.create).not.toHaveBeenCalled();
  expect(driver.render).not.toHaveBeenCalled();
  view.rerender(ui(true));
  expect(frames).toHaveLength(2);
  await act(async () => frames[1](1));
  expect(driver.create).toHaveBeenCalledOnce();
  expect(driver.render).toHaveBeenCalledOnce();
});
it.each(['revocation', 'assignment'] as const)(
  'retires the retained original allocation during %s and blocks late callbacks until Fiber completes',
  async (reason) => {
    const privacy = verifiedOwner();
    let finish!: () => void;
    driver.teardown.mockImplementation((_canvas, complete) => {
      finish = complete;
    });
    const failure = vi.fn();
    const ui = (ready: boolean) => (
      <PrivacyReadinessContext value={privacy(ready)}>
        <SafeCanvas onFailure={failure}>scene</SafeCanvas>
      </PrivacyReadinessContext>
    );
    const view = render(ui(true));
    await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
    const session = contextValue<{ current(): boolean }>(
      driver.render.mock.calls[0][0],
      SceneSessionContext,
    );
    view.rerender(ui(false));
    const created = driver.configure.mock.calls[0][0].onCreated;
    const connect = vi.fn();
    act(() => {
      if (reason === 'revocation') revokePrivatePresentation();
      else invalidateAssignmentCallbacks();
      expect(view.container.firstElementChild).toHaveAttribute('hidden');
      expect(view.container.firstElementChild).toHaveAttribute('inert');
      created({ events: { connect } });
    });
    expect(connect).not.toHaveBeenCalled();
    expect(session?.current()).toBe(false);
    await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
    const renders = driver.render.mock.calls.length;
    view.rerender(ui(true));
    expect(driver.render).toHaveBeenCalledTimes(renders);
    expect(driver.create).toHaveBeenCalledOnce();
    act(() => finish());
    expect(driver.create).toHaveBeenCalledOnce();
    expect(failure).not.toHaveBeenCalled();
  },
);
it.each(['revocationRevision', 'verifiedEpoch'] as const)(
  'rejects stale %s even when readiness claims a fresh grant',
  async (field) => {
    const privacy = verifiedOwner();
    render(
      <PrivacyReadinessContext value={{ ...privacy(true), [field]: -1 }}>
        <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>
      </PrivacyReadinessContext>,
    );
    await act(async () => {});
    expect(driver.create).not.toHaveBeenCalled();
    expect(driver.render).not.toHaveBeenCalled();
  },
);
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
  expect(driver.render).not.toHaveBeenCalled();
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

it('keeps a preempted allocation withdrawn across privacy refresh and slot release until explicit fresh Resume', async () => {
  const privacy = verifiedOwner();
  const completions: (() => void)[] = [];
  driver.teardown.mockImplementation((_canvas, complete) =>
    completions.push(complete),
  );
  const ui = (picker: boolean, ready: boolean) => (
    <PrivacyReadinessContext value={privacy(ready)}>
      <RoomSceneBudgetProvider>
        <ScenePriorityContext value={0}>
          <SafeCanvas onFailure={vi.fn()}>preview</SafeCanvas>
        </ScenePriorityContext>
        {picker && (
          <ScenePriorityContext value={2}>
            <SafeCanvas onFailure={vi.fn()}>picker</SafeCanvas>
          </ScenePriorityContext>
        )}
      </RoomSceneBudgetProvider>
    </PrivacyReadinessContext>
  );
  const view = render(ui(false, true));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  view.rerender(ui(true, true));
  await waitFor(() => expect(completions).toHaveLength(1));
  view.rerender(ui(true, false));
  view.rerender(ui(true, true));
  expect(driver.create).toHaveBeenCalledOnce();
  expect(
    screen.getAllByRole('button', { name: 'Resume map' }),
  ).not.toHaveLength(0);
  act(() => completions[0]());
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
  view.rerender(ui(false, true));
  await waitFor(() => expect(completions).toHaveLength(2));
  expect(driver.create).toHaveBeenCalledTimes(2);
  act(() => completions[1]());
  view.rerender(ui(false, false));
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Resume map' }));
  view.rerender(ui(false, true));
  // A fresh grant or a newly free slot cannot substitute for the user's Resume.
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(driver.create).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Resume map' })).toBeVisible();
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

it('reports synchronous root construction failure once, releases its lease and permits a fresh retry', async () => {
  driver.create.mockImplementationOnce(() => {
    throw new Error('Synchronous root failure');
  });
  const onFailure = vi.fn();
  const view = render(<SafeCanvas onFailure={onFailure}>scene</SafeCanvas>);
  await waitFor(() => expect(onFailure).toHaveBeenCalledOnce());
  expect(driver.configure).not.toHaveBeenCalled();
  expect(driver.teardown).not.toHaveBeenCalled();
  expect(view.container.querySelector('canvas')).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Resume map' }));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(driver.create).toHaveBeenCalledTimes(2);
  expect(onFailure).toHaveBeenCalledOnce();
  view.unmount();
  const newFailure = vi.fn();
  render(<SafeCanvas onFailure={newFailure}>new session</SafeCanvas>);
  await waitFor(() => expect(driver.render).toHaveBeenCalledTimes(2));
  expect(newFailure).not.toHaveBeenCalled();
  expect(onFailure).toHaveBeenCalledOnce();
});

it('does not report a synchronous construction failure after its presentation has been revoked', async () => {
  driver.create.mockImplementationOnce(() => {
    revokePrivatePresentation();
    throw new Error('Retired root failure');
  });
  const onFailure = vi.fn();
  const view = render(
    <SafeCanvas onFailure={onFailure}>retired scene</SafeCanvas>,
  );
  await waitFor(() => expect(driver.create).toHaveBeenCalledOnce());
  await act(async () => {});
  expect(onFailure).not.toHaveBeenCalled();
  expect(driver.render).not.toHaveBeenCalled();
  view.unmount();
  const nextFailure = vi.fn();
  render(<SafeCanvas onFailure={nextFailure}>fresh scene</SafeCanvas>);
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  expect(nextFailure).not.toHaveBeenCalled();
});

it('ignores a retired graphics boundary callback after preemption and resume without clearing the new lease', async () => {
  const failure = vi.fn();
  const pickerFailure = vi.fn();
  const ui = (picker: boolean) => (
    <RoomSceneBudgetProvider>
      <ScenePriorityContext value={0}>
        <SafeCanvas onFailure={failure}>preview</SafeCanvas>
      </ScenePriorityContext>
      {picker && (
        <ScenePriorityContext value={2}>
          <SafeCanvas onFailure={pickerFailure}>picker</SafeCanvas>
        </ScenePriorityContext>
      )}
    </RoomSceneBudgetProvider>
  );
  const boundaryFailure = (tree: ReactNode) => {
    let callback!: (message: string) => void;
    const visit = (children: ReactNode) =>
      Children.forEach(children, (child) => {
        if (
          !isValidElement<{
            children?: ReactNode;
            onFailure?: (message: string) => void;
          }>(child)
        )
          return;
        if (child.type === GraphicsBoundary) callback = child.props.onFailure!;
        visit(child.props.children);
      });
    visit(tree);
    expect(callback).toBeTypeOf('function');
    return callback;
  };
  const view = render(ui(false));
  await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
  const retiredFailure = boundaryFailure(driver.render.mock.calls[0][0]);
  view.rerender(ui(true));
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
  act(() => retiredFailure('Retired scene failed'));
  expect(failure).not.toHaveBeenCalled();
  view.rerender(ui(false));
  await waitFor(() => expect(driver.teardown).toHaveBeenCalledTimes(2));
  const rendersBeforeResume = driver.render.mock.calls.length;
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Resume map' }));
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(driver.render.mock.calls.length).toBeGreaterThan(
      rendersBeforeResume,
    ),
  );
  const currentFailure = boundaryFailure(driver.render.mock.calls.at(-1)![0]);
  act(() => retiredFailure('Retired scene failed after resume'));
  expect(failure).not.toHaveBeenCalled();
  expect(view.container.querySelectorAll('canvas')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Resume map' })).toBeNull();
  act(() => currentFailure('Current scene failed'));
  expect(failure).toHaveBeenCalledExactlyOnceWith('Current scene failed');
});

it.each(['resolve', 'reject'] as const)(
  'starts unmount while configure is pending and keeps the lease through late %s until Fiber completes',
  async (outcome) => {
    let resolve!: (value: unknown) => void;
    let reject!: (error: Error) => void;
    driver.configure.mockImplementationOnce(
      () =>
        new Promise((success, failure) => {
          resolve = success;
          reject = failure;
        }),
    );
    const completions: (() => void)[] = [];
    driver.teardown.mockImplementation((_canvas, complete) =>
      completions.push(complete),
    );
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
    await waitFor(() => expect(driver.configure).toHaveBeenCalledOnce());
    view.rerender(ui(true));
    // Teardown begins before the configuration promise has settled.
    await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
    expect(driver.create).toHaveBeenCalledOnce();
    expect(driver.render).not.toHaveBeenCalled();
    await act(async () => {
      if (outcome === 'resolve') resolve(undefined);
      else reject(new Error('Late configuration rejection'));
    });
    expect(failure).not.toHaveBeenCalled();
    expect(driver.teardown).toHaveBeenCalledOnce();
    expect(driver.create).toHaveBeenCalledOnce();
    expect(driver.configure).toHaveBeenCalledOnce();
    expect(driver.render).not.toHaveBeenCalled();
    // Only actual Fiber completion permits the successor; duplicate completion
    // cannot release that successor's newly acquired allocation.
    act(() => {
      completions[0]();
      completions[0]();
    });
    await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(driver.render).toHaveBeenCalledOnce());
    expect(driver.configure).toHaveBeenCalledTimes(2);
    expect(failure).not.toHaveBeenCalled();
    view.unmount();
    await waitFor(() => expect(driver.teardown).toHaveBeenCalledTimes(2));
    act(() => {
      completions[1]();
      completions[1]();
    });
    expect(driver.create).toHaveBeenCalledTimes(2);
  },
);

it('announces startup before the passive budget request without false contention or Resume', () => {
  const html = renderToString(
    <SafeCanvas onFailure={vi.fn()}>scene</SafeCanvas>,
  );
  expect(html).toContain('Loading map');
  expect(html).toContain('aria-busy="true"');
  expect(html).not.toContain('another map');
  expect(html).not.toContain('Resume map');
  expect(driver.create).not.toHaveBeenCalled();
});
it('retains genuine queued feedback until the active allocation actually completes', async () => {
  let finish!: () => void;
  driver.teardown.mockImplementation((_canvas, complete) => {
    finish = complete;
  });
  const ui = (primary: boolean) => (
    <RoomSceneBudgetProvider>
      {primary && (
        <ScenePriorityContext value={2}>
          <SafeCanvas onFailure={vi.fn()}>primary</SafeCanvas>
        </ScenePriorityContext>
      )}
      <ScenePriorityContext value={0}>
        <SafeCanvas onFailure={vi.fn()}>queued</SafeCanvas>
      </ScenePriorityContext>
    </RoomSceneBudgetProvider>
  );
  const view = render(ui(true));
  await waitFor(() => expect(driver.create).toHaveBeenCalledOnce());
  expect(screen.getByRole('status')).toHaveTextContent('another map');
  expect(screen.getByRole('button', { name: 'Resume map' })).toBeVisible();
  view.rerender(ui(false));
  await waitFor(() => expect(driver.teardown).toHaveBeenCalledOnce());
  expect(screen.getByRole('status')).toHaveTextContent('another map');
  act(() => finish());
  await waitFor(() => expect(driver.create).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole('button', { name: 'Resume map' })).toBeNull();
});
