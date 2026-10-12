import {
  Component,
  StrictMode,
  Suspense,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createRoutePendingState } from './route-pending-state';
import { createRoutePendingOwners } from './route-pending-owners';
import {
  RouteLoading,
  RoutePendingContext,
  RouteProgress,
  RouteTransitionRunner,
  useRouteTask,
  useRouteTransition,
  useRouteRouter,
} from './route-pending';

const runtime = vi.hoisted(() => ({ reduced: false, replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: runtime.replace }),
}));
vi.mock('./motion-preference', () => ({
  useEffectiveReducedMotion: () => runtime.reduced,
}));
beforeEach(() => {
  runtime.reduced = false;
  runtime.replace.mockReset();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Harness({
  state,
  children,
}: {
  state: ReturnType<typeof createRoutePendingState>;
  children: React.ReactNode;
}) {
  const [owners] = useState(createRoutePendingOwners);
  const mounted = useSyncExternalStore(
    owners.subscribe,
    owners.snapshot,
    owners.snapshot,
  );
  const scope = useMemo(
    () => ({ state, owners, terminal: () => state.cancel() }),
    [state, owners],
  );
  const snapshot = useSyncExternalStore(
    state.subscribe,
    state.snapshot,
    state.snapshot,
  );
  return (
    <RoutePendingContext.Provider value={scope}>
      {mounted.map((owner) => (
        <RouteTransitionRunner
          key={`${owner.id}:${snapshot.epoch}`}
          scope={scope}
          epoch={snapshot.epoch}
          owner={owner}
        />
      ))}
      <RouteProgress />
      {children}
    </RoutePendingContext.Provider>
  );
}
function Action({
  work,
  label = 'Start work',
  signal,
}: {
  work: Promise<void>;
  label?: string;
  signal?: AbortSignal;
}) {
  const [pending, start] = useRouteTask();
  const [completed, setCompleted] = useState(false);
  return (
    <>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await work;
            setCompleted(true);
          }, signal)
        }
      >
        {label}
      </button>
      <p>
        {label}: {completed ? 'Ready' : pending ? 'Working' : 'Idle'}
      </p>
    </>
  );
}
function Content({ read }: { read: () => void }) {
  read();
  return <p>Destination ready</p>;
}
const progress = () => document.querySelector('.experience-route-progress')!;

it('tracks the actual async task and releases progress only after completion UI commits', async () => {
  const work = deferred();
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <Action work={work.promise} />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Start work: Working');
  expect(progress()).toHaveAttribute('data-visible', 'false');
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  await screen.findByText('Start work: Ready');
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'false'),
  );
});

it('reports real streamed fallback lifetime, including retained loading after Back cancellation', async () => {
  const work = deferred();
  let ready = false;
  const read = () => {
    if (!ready) throw work.promise;
  };
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <Suspense fallback={<RouteLoading />}>
        <Content read={read} />
      </Suspense>
    </Harness>,
  );
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  act(() => state.cancel());
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  await act(async () => {
    ready = true;
    work.resolve();
    await work.promise;
  });
  await screen.findByText('Destination ready');
  expect(state.snapshot().pending).toBe(false);
});

it('announces an actual slow Suspense fallback once alongside shared progress', async () => {
  const work = deferred();
  const state = createRoutePendingState();
  const view = render(
    <Harness state={state}>
      <Suspense fallback={<RouteLoading />}>
        <Content
          read={() => {
            throw work.promise;
          }}
        />
      </Suspense>
    </Harness>,
  );
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  expect(screen.getAllByRole('status')).toHaveLength(1);
  view.unmount();
});

it('reduced motion exposes static work immediately and completes immediately on readiness', async () => {
  runtime.reduced = true;
  const work = deferred();
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <Action work={work.promise} />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Start work: Working');
  expect(progress()).toHaveAttribute('data-visible', 'true');
  expect(progress()).toHaveAttribute('data-static', 'true');
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'false'),
  );
});

it('retired pending action completion cannot restart progress or remount a draft', async () => {
  const work = deferred();
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <input aria-label="Draft" defaultValue="preserved" />
      <Action work={work.promise} />
    </Harness>,
  );
  const draft = screen.getByRole('textbox');
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Start work: Working');
  act(() => state.cancel());
  expect(progress()).toHaveAttribute('data-visible', 'false');
  expect(screen.getByRole('button')).toBeDisabled();
  expect(screen.getByText('Start work: Working')).toBeVisible();
  await act(async () => {
    work.resolve();
    await work.promise;
  });
  expect(state.snapshot().pending).toBe(false);
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('preserved');
});

function OverlappingTasks({
  first,
  second,
}: {
  first: Promise<void>;
  second: Promise<void>;
}) {
  const [pending, start] = useRouteTask();
  const [completions, setCompletions] = useState(0);
  const run = (work: Promise<void>) =>
    start(async () => {
      await work;
      setCompletions((value) => value + 1);
    });
  return (
    <>
      <button onClick={() => run(first)}>First invocation</button>
      <button onClick={() => run(second)}>Second invocation</button>
      <output>
        {pending ? 'Same owner busy' : 'Same owner idle'}; {completions}{' '}
        completed
      </output>
    </>
  );
}
it('presentation retirement does not clear overlapping local invocations in the same owner', async () => {
  const first = deferred();
  const second = deferred();
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <OverlappingTasks first={first.promise} second={second.promise} />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'First invocation' }));
  await screen.findByText('Same owner busy; 0 completed');
  act(() => state.cancel());
  expect(state.snapshot().pending).toBe(false);
  expect(screen.getByText('Same owner busy; 0 completed')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Second invocation' }));
  await waitFor(() => expect(state.snapshot().pending).toBe(true));
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(screen.getByText('Same owner busy; 1 completed')).toBeVisible();
  expect(state.snapshot().pending).toBe(true);
  await act(async () => {
    second.resolve();
    await second.promise;
  });
  await screen.findByText('Same owner idle; 2 completed');
  await waitFor(() => expect(state.snapshot().pending).toBe(false));
});

it('retiring a departed caller does not hold the replacement caller behind its unfinished action', async () => {
  const first = deferred();
  const second = deferred();
  const state = createRoutePendingState();
  const view = render(
    <StrictMode>
      <Harness state={state}>
        <Action key="first" label="First" work={first.promise} />
      </Harness>
    </StrictMode>,
  );
  try {
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    await screen.findByText('First: Working');
    view.rerender(
      <StrictMode>
        <Harness state={state}>
          <Action key="second" label="Second" work={second.promise} />
        </Harness>
      </StrictMode>,
    );
    expect(state.snapshot().pending).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));
    await waitFor(() => expect(state.snapshot().pending).toBe(true));
    await act(async () => {
      second.resolve();
      await second.promise;
    });
    // First is still unresolved. Returning these promises to React originally
    // failed this assertion through its shared async-action entanglement.
    await waitFor(() => expect(state.snapshot().pending).toBe(false));
    await act(async () => {
      first.resolve();
      await first.promise;
    });
    expect(state.snapshot().pending).toBe(false);
  } finally {
    await act(async () => {
      first.resolve();
      second.resolve();
      await Promise.all([first.promise, second.promise]);
    });
  }
});

function RouteUpdate({ read }: { read: () => void }) {
  const [changed, setChanged] = useState(false);
  const [pending, start] = useRouteTransition();
  return (
    <>
      <button
        onClick={() =>
          start(() => {
            setChanged(true);
          })
        }
      >
        Change route content
      </button>
      <p>{pending ? 'Route pending' : 'Route settled'}</p>
      <Suspense fallback={<RouteLoading />}>
        {changed ? <Content read={read} /> : <p>Existing route title</p>}
      </Suspense>
    </>
  );
}
it('synchronous route transitions retain pending until actual suspended content commits', async () => {
  const work = deferred();
  let ready = false;
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <RouteUpdate
        read={() => {
          if (!ready) throw work.promise;
        }}
      />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Route pending');
  expect(screen.getByText('Existing route title')).toBeVisible();
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  await act(async () => {
    ready = true;
    work.resolve();
    await work.promise;
  });
  await screen.findByText('Destination ready');
  await waitFor(() => expect(state.snapshot().pending).toBe(false));
});

function RouterUpdate({
  read,
  onFailure,
}: {
  read: () => void;
  onFailure: (error: unknown) => void;
}) {
  const router = useRouteRouter();
  const [changed, setChanged] = useState(false);
  runtime.replace.mockImplementation(() => {
    setChanged(true);
  });
  return (
    <>
      <button
        onClick={() => {
          try {
            router.replace('/destination');
          } catch (error) {
            onFailure(error);
          }
        }}
      >
        Navigate with router
      </button>
      <Suspense fallback={<RouteLoading />}>
        {changed ? <Content read={read} /> : <p>Existing router title</p>}
      </Suspense>
    </>
  );
}
function RouterFailure({ onFailure }: { onFailure: (error: unknown) => void }) {
  const router = useRouteRouter();
  return (
    <button
      onClick={() => {
        try {
          router.replace('/destination');
        } catch (error) {
          onFailure(error);
        }
      }}
    >
      Try router
    </button>
  );
}
it.each([new Error('Original router error'), undefined])(
  'preserves the exact synchronous router throw for the original caller',
  async (original) => {
    const state = createRoutePendingState();
    const caught = vi.fn();
    runtime.replace.mockImplementation(() => {
      throw original;
    });
    render(
      <Harness state={state}>
        <RouterFailure onFailure={caught} />
      </Harness>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(caught).toHaveBeenCalledExactlyOnceWith(original);
    expect(runtime.replace).toHaveBeenCalledOnce();
    await waitFor(() => expect(state.snapshot().pending).toBe(false));
  },
);
it('valid tracked router navigation stays pending until the actual content reveal', async () => {
  const state = createRoutePendingState();
  const work = deferred();
  const caught = vi.fn();
  let ready = false;
  render(
    <Harness state={state}>
      <RouterUpdate
        read={() => {
          if (!ready) throw work.promise;
        }}
        onFailure={caught}
      />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(runtime.replace).toHaveBeenCalledExactlyOnceWith('/destination');
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  expect(screen.getByText('Existing router title')).toBeVisible();
  await act(async () => {
    ready = true;
    work.resolve();
    await work.promise;
  });
  await screen.findByText('Destination ready');
  expect(state.snapshot().pending).toBe(false);
  expect(caught).not.toHaveBeenCalled();
});

class TaskErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: unknown }
> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <p>Task failed: {(this.state.error as Error).message}</p>
    ) : (
      this.props.children
    );
  }
}
it('unexpected task rejection reaches the actual error boundary and withdraws progress', async () => {
  const original = new Error('Original failure');
  let reject!: (error: unknown) => void;
  const work = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const state = createRoutePendingState();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(
      <Harness state={state}>
        <TaskErrorBoundary>
          <Action work={work} />
        </TaskErrorBoundary>
      </Harness>,
    );
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(progress()).toHaveAttribute('data-visible', 'true'),
    );
    await act(async () => {
      reject(original);
      await work.catch(() => {});
    });
    await screen.findByText('Task failed: Original failure');
    expect(state.snapshot().pending).toBe(false);
  } finally {
    consoleError.mockRestore();
  }
});

it('late rejection from a departed owner cannot fail the replacement owner or restart progress', async () => {
  let reject!: (error: unknown) => void;
  const old = new Promise<void>((_resolve, fail) => {
    reject = fail;
  });
  const next = deferred();
  const state = createRoutePendingState();
  const view = render(
    <Harness state={state}>
      <TaskErrorBoundary>
        <Action key="old" work={old} />
      </TaskErrorBoundary>
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Start work: Working');
  view.rerender(
    <Harness state={state}>
      <TaskErrorBoundary>
        <Action key="new" label="Replacement" work={next.promise} />
      </TaskErrorBoundary>
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button'));
  await act(async () => {
    next.resolve();
    await next.promise;
  });
  await screen.findByText('Replacement: Ready');
  await act(async () => {
    reject(new Error('Stale failure'));
    await old.catch(() => {});
  });
  expect(screen.queryByText(/Task failed/)).not.toBeInTheDocument();
  expect(state.snapshot().pending).toBe(false);
});

it('an owned abort retires only its request presentation even if transport settlement arrives late', async () => {
  const first = deferred();
  const second = deferred();
  const controller = new AbortController();
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <Action label="Aborted" work={first.promise} signal={controller.signal} />
      <Action label="Live" work={second.promise} />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Aborted' }));
  fireEvent.click(screen.getByRole('button', { name: 'Live' }));
  await waitFor(() => expect(state.snapshot().pending).toBe(true));
  act(() => controller.abort());
  expect(state.snapshot().pending).toBe(true);
  await act(async () => {
    second.resolve();
    await second.promise;
  });
  await waitFor(() => expect(state.snapshot().pending).toBe(false));
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(state.snapshot().pending).toBe(false);
});

it('keeps progress for the other live owner when one of two actions finishes', async () => {
  const first = deferred();
  const second = deferred();
  const state = createRoutePendingState();
  render(
    <Harness state={state}>
      <Action label="First" work={first.promise} />
      <Action label="Second" work={second.promise} />
    </Harness>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'First' }));
  fireEvent.click(screen.getByRole('button', { name: 'Second' }));
  await waitFor(() =>
    expect(progress()).toHaveAttribute('data-visible', 'true'),
  );
  await act(async () => {
    first.resolve();
    await first.promise;
  });
  expect(state.snapshot().pending).toBe(true);
  expect(progress()).toHaveAttribute('data-visible', 'true');
  await act(async () => {
    second.resolve();
    await second.promise;
  });
  await waitFor(() => expect(state.snapshot().pending).toBe(false));
});
