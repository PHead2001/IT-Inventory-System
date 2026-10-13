import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  Activity,
  Suspense,
  ViewTransition,
  startTransition,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
} from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { PageArrival } from './page-arrival';
import {
  RoutePresentationLifetimeContext,
  RoutePresentationSourceContext,
} from './route-presentation-source';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';

const route = vi.hoisted(() => ({
  pathname: '/dashboard',
  enabled: true,
  boundaries: [] as Array<import('react').ViewTransitionProps>,
}));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
vi.mock('./route-motion', () => ({
  useRouteMotion: () => ({
    enabled: route.enabled,
    arrivalEnabled: route.enabled,
    finishArrival: vi.fn(),
    cancelIfInvalid: vi.fn(),
    finishArrivalAfterSnapshot: vi.fn(),
  }),
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    ViewTransition: (props: import('react').ViewTransitionProps) => {
      route.boundaries.push(props as (typeof route.boundaries)[number]);
      return props.children;
    },
  };
});

it('consumes each committed pathname update before same-path refreshes can replay it', () => {
  route.pathname = '/inventory';
  const node = (pathname: string) => (
    <PageArrival pathname={pathname}>
      <PersistentForm />
    </PageArrival>
  );
  const page = render(node('/inventory'));
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'one mounted draft' } });
  route.pathname = '/history';
  page.rerender(node('/history'));
  expect(
    route.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(true);
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined)
      ?.update,
  ).toBe('none');
  route.boundaries = [];
  page.rerender(node('/history'));
  expect(
    route.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(false);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('one mounted draft');
  expect(mounts).toBe(1);
});

it('keeps captured callbacks bound to their original source through cleanup and later pathname commits', () => {
  const lifetime = createRoutePresentationLifetime();
  let source: symbol | undefined;
  function SourceWitness() {
    const currentSource = useContext(RoutePresentationSourceContext);
    useLayoutEffect(() => {
      source = currentSource;
    }, [currentSource]);
    return <PersistentForm />;
  }
  const node = (pathname: string) => (
    <RoutePresentationLifetimeContext value={lifetime}>
      <PageArrival pathname={pathname}>
        <SourceWitness />
      </PageArrival>
    </RoutePresentationLifetimeContext>
  );
  route.pathname = '/inventory';
  const page = render(node('/inventory'));
  const oldTicket = lifetime.capture(
    source!,
    () => true,
    () => true,
  )!;
  expect(oldTicket.current()).toBe(true);
  lifetime.navigation();
  route.pathname = '/history';
  page.rerender(node('/history'));
  const oldCallback = route.boundaries.findLast(
    (boundary) => boundary.update === 'route-content',
  )!.onUpdate!;
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined)
      ?.update,
  ).toBe('none');
  // The original committed descriptor survives the state cleanup render.
  const finishOld = oldCallback({ name: 'old' } as never, []);
  expect(oldTicket.current()).toBe(true);
  const nextTicket = lifetime.capture(
    source!,
    () => true,
    () => true,
  )!;
  lifetime.navigation();
  route.pathname = '/settings';
  page.rerender(node('/settings'));
  const nextCallback = route.boundaries.findLast(
    (boundary) => boundary.update === 'route-content',
  )!.onUpdate!;
  const finishNext = nextCallback({ name: 'next' } as never, []);
  expect(nextTicket.current()).toBe(true);
  expect(finishOld).toEqual(expect.any(Function));
  act(() => {
    if (typeof finishOld === 'function') finishOld();
  });
  expect(nextTicket.current()).toBe(true);
  expect(oldCallback({ name: 'late-old' } as never, [])).toBeUndefined();
  expect(nextTicket.current()).toBe(true);
  expect(finishNext).toEqual(expect.any(Function));
  act(() => {
    if (typeof finishNext === 'function') finishNext();
  });
  expect(nextTicket.current()).toBe(false);
  oldTicket.release();
  nextTicket.release();
});

it('does not resurrect a static pathname change when motion is enabled later', () => {
  route.pathname = '/inventory';
  route.enabled = false;
  const node = (pathname: string) => (
    <PageArrival pathname={pathname}>
      <PersistentForm />
    </PageArrival>
  );
  const page = render(node('/inventory'));
  route.pathname = '/history';
  page.rerender(node('/history'));
  route.enabled = true;
  route.boundaries = [];
  page.rerender(node('/history'));
  expect(
    route.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(false);
  expect(mounts).toBe(1);
});

it('isolates descendant-only and query/refresh changes while nested titles keep their own explicit opt-in', () => {
  function Child() {
    const [count, setCount] = useState(0);
    return (
      <>
        <button onClick={() => setCount(count + 1)}>Child count {count}</button>
        <ViewTransition
          name="child-title"
          share="record-title"
          update="record-title"
        >
          <h2>Nested title</h2>
        </ViewTransition>
      </>
    );
  }
  route.pathname = '/inventory';
  const page = render(
    <PageArrival pathname="/inventory">
      <Child />
    </PageArrival>,
  );
  route.pathname = '/history';
  page.rerender(
    <PageArrival pathname="/history">
      <Child />
    </PageArrival>,
  );
  const outer = page.container.querySelector('[data-route-path]');
  expect(outer).toHaveAttribute('data-route-path', '/history');
  const outerCount = route.boundaries.filter(
    (boundary) => boundary.enter !== undefined,
  ).length;
  fireEvent.click(screen.getByRole('button', { name: 'Child count 0' }));
  expect(screen.getByRole('button', { name: 'Child count 1' })).toBeVisible();
  expect(
    route.boundaries.filter((boundary) => boundary.enter !== undefined),
  ).toHaveLength(outerCount);
  page.rerender(
    <PageArrival pathname="/history">
      <Child />
    </PageArrival>,
  );
  expect(page.container.querySelector('[data-route-path]')).toBe(outer);
  expect(
    route.boundaries.some(
      (boundary) =>
        boundary.enter === undefined &&
        boundary.update === 'none' &&
        boundary.default === 'none',
    ),
  ).toBe(true);
  expect(
    route.boundaries.findLast((boundary) => boundary.name === 'child-title'),
  ).toMatchObject({ share: 'record-title', update: 'record-title' });
});

it('abandoned B cannot checkpoint source history before C commits and a later B retry', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let blocked = true;
  let navigate!: (pathname: string) => void;
  function Content({ pathname }: { pathname: string }) {
    if (pathname === '/history' && blocked) throw pending;
    return <p>Committed {pathname}</p>;
  }
  function Harness() {
    const [pathname, setPathname] = useState('/room');
    useLayoutEffect(() => {
      navigate = setPathname;
    }, []);
    return (
      <Suspense fallback={<p>Waiting</p>}>
        <PageArrival pathname={pathname}>
          <Content pathname={pathname} />
        </PageArrival>
      </Suspense>
    );
  }
  route.pathname = '/inventory';
  const page = render(<Harness />);
  await act(async () => {
    startTransition(() => navigate('/history'));
  });
  expect(page.container.querySelector('[data-route-path]')).toHaveAttribute(
    'data-route-path',
    '/room',
  );
  act(() => navigate('/settings'));
  expect(screen.getByText('Committed /settings')).toBeVisible();
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined)
      ?.update,
  ).toBe('none');
  blocked = false;
  await act(async () => {
    release();
    await pending;
  });
  route.boundaries = [];
  await act(async () => {
    startTransition(() => navigate('/history'));
  });
  expect(screen.getByText('Committed /history')).toBeVisible();
  expect(
    route.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(true);
});
let mounts = 0;
function PersistentForm() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <input aria-label="Unsaved note" defaultValue="retain me" />;
}
beforeEach(() => {
  mounts = 0;
  route.pathname = '/dashboard';
  route.enabled = true;
  route.boundaries = [];
});

it('leaves the commit to React and preserves drafts on query/refresh updates', () => {
  const animate = vi.fn();
  Element.prototype.animate = animate;
  const { rerender } = render(
    <PageArrival pathname={route.pathname}>
      <PersistentForm />
    </PageArrival>,
  );
  const input = screen.getByRole('textbox', { name: 'Unsaved note' });
  fireEvent.change(input, { target: { value: 'draft' } });
  rerender(
    <PageArrival pathname={route.pathname}>
      <PersistentForm />
    </PageArrival>,
  );
  expect(input).toHaveValue('draft');
  expect(mounts).toBe(1);
  expect(animate).not.toHaveBeenCalled();
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined),
  ).toMatchObject({
    default: 'none',
    enter: 'route-content',
    exit: 'route-content',
  });
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined)
      ?.update,
  ).toBe('none');
  delete (Element.prototype as Partial<Element>).animate;
});

it('accepted A to B to Back keeps the persistent router child and its cached draft instead of keying the ancestor', () => {
  let cacheMounts = 0;
  function CachedRouter({ pathname }: { pathname: string }) {
    const [identity] = useState(() => ++cacheMounts);
    return (
      <div data-cache-identity={identity}>
        <Activity mode={pathname === '/inventory' ? 'visible' : 'hidden'}>
          <PersistentForm />
        </Activity>
        <Activity mode={pathname === '/history' ? 'visible' : 'hidden'}>
          <p>Cached history</p>
        </Activity>
      </div>
    );
  }
  const node = (pathname: string) => (
    <PageArrival pathname={pathname}>
      <CachedRouter pathname={pathname} />
    </PageArrival>
  );
  route.pathname = '/inventory';
  const page = render(node('/inventory'));
  const draft = screen.getByRole('textbox', { name: 'Unsaved note' });
  fireEvent.change(draft, {
    target: { value: 'cached camera/workspace analogue' },
  });
  route.pathname = '/history';
  route.boundaries = [];
  page.rerender(node('/history'));
  expect(
    route.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(true);
  expect(screen.getByText('Cached history')).toBeVisible();
  route.pathname = '/inventory';
  route.boundaries = [];
  page.rerender(node('/inventory'));
  expect(screen.getByRole('textbox', { name: 'Unsaved note' })).toBe(draft);
  expect(draft).toHaveValue('cached camera/workspace analogue');
  expect(cacheMounts).toBe(1);
  expect(
    route.boundaries.some((boundary) => boundary.update === 'route-content'),
  ).toBe(true);
  page.rerender(node('/inventory'));
  expect(page.container.querySelector('[data-route-path]')).toHaveAttribute(
    'data-route-path',
    '/inventory',
  );
  expect(route.boundaries.at(-1)?.update).toBe('none');
});

it.each([
  ['/room', '/inventory'],
  ['/inventory', '/room'],
] as const)(
  'excludes update snapshots when either accepted source or destination is the room (%s to %s)',
  (from, to) => {
    route.pathname = from;
    const page = render(
      <PageArrival pathname={from}>
        <PersistentForm />
      </PageArrival>,
    );
    route.pathname = to;
    page.rerender(
      <PageArrival pathname={to}>
        <PersistentForm />
      </PageArrival>,
    );
    expect(
      route.boundaries.findLast((boundary) => boundary.enter !== undefined)
        ?.update,
    ).toBe('none');
  },
);

it.each([
  ['/room', true],
  ['/inventory', false],
] as const)(
  'omits the whole snapshot on %s when enabled=%s',
  (pathname, enabled) => {
    route.pathname = pathname;
    route.enabled = enabled;
    render(
      <PageArrival pathname={route.pathname}>
        <p>Live content</p>
      </PageArrival>,
    );
    expect(
      route.boundaries.findLast((boundary) => boundary.enter !== undefined),
    ).toMatchObject({
      default: 'none',
      enter: 'none',
      exit: 'none',
    });
    expect(screen.getByText('Live content')).toBeVisible();
  },
);

it('a live path recheck cannot remount an accepted page or enable snapshots of a retained room ancestor', () => {
  const view = render(
    <PageArrival pathname="/inventory">
      <PersistentForm />
    </PageArrival>,
  );
  const input = screen.getByRole('textbox');
  fireEvent.change(input, { target: { value: 'accepted draft' } });
  route.pathname = '/room';
  view.rerender(
    <PageArrival pathname="/inventory">
      <PersistentForm />
    </PageArrival>,
  );
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('accepted draft');
  expect(mounts).toBe(1);
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined),
  ).toMatchObject({
    enter: 'none',
    exit: 'none',
  });
  route.pathname = '/inventory';
  view.rerender(
    <PageArrival pathname="/room">
      <p>Retained room canvas ancestor</p>
    </PageArrival>,
  );
  expect(
    route.boundaries.findLast((boundary) => boundary.enter !== undefined),
  ).toMatchObject({
    enter: 'none',
    exit: 'none',
  });
});
