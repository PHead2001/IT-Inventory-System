import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ViewTransitionProps } from 'react';
import type { RouteArrivalIntent } from './route-motion-state';
import { PairedInventoryContent } from './paired-inventory-content';
import { RouteContentIdentityContext } from './route-content-identity';
import {
  RoutePresentationLifetimeContext,
  RoutePresentationSourceContext,
} from './route-presentation-source';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';
import { routeContentMotion } from './route-content-motion';

vi.mock('./route-content-motion', () => ({ routeContentMotion: vi.fn() }));

const state = vi.hoisted(() => ({
  boundaries: [] as ViewTransitionProps[],
  enabled: true,
  current: true,
  primary: null as RouteArrivalIntent | null,
  primaryFinish: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('./route-motion', () => ({
  useRouteMotion: () => {
    const primary = state.primary;
    return {
      enabled: state.enabled,
      current: () => state.current,
      validNow: () => state.current && state.enabled,
      intent: primary
        ? null
        : {
            name: 'inventory-title-proof',
            kind: 'quantity',
            id: 'one',
            detailPath: '/inventory/quantity/one',
            listHref: '/inventory?q=x',
            rawSourceRouteKey: '/inventory?q=++x++',
          },
      arrival: primary,
      finishPrimaryAfterSnapshot: (instance: { name: string }) => {
        state.primaryFinish(instance);
        return (
          state.current &&
          !!primary &&
          primary === state.primary &&
          instance.name === primary.name
        );
      },
      titleArrival:
        state.enabled && !primary
          ? {
              sourceKey: '/inventory?q=++x++',
              destinationKey: '/inventory/quantity/one',
              epoch: 1,
            }
          : null,
      cancelIfInvalid: state.cancel,
      finishPairedContentAfterSnapshot: state.finish,
      rejectTitleSnapshot: vi.fn(),
    };
  },
}));
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    ViewTransition: (props: ViewTransitionProps) => {
      state.boundaries.push(props);
      return props.children;
    },
  };
});
beforeEach(() => {
  state.boundaries = [];
  state.enabled = true;
  state.current = true;
  state.primary = null;
  state.primaryFinish.mockClear();
  state.finish.mockClear();
});
const identity = (key: string) => ({
  rawRouteKey: key,
  listHref: '/inventory?q=x',
  pathname: key.split('?')[0],
});

it('keeps the wrapper/content mounted while exact raw approval is withdrawn or mismatched', () => {
  const fixture = (key: string) => (
    <RouteContentIdentityContext value={identity(key)}>
      <PairedInventoryContent enabled>
        <input aria-label="Retained draft" defaultValue="draft" />
      </PairedInventoryContent>
    </RouteContentIdentityContext>
  );
  const page = render(fixture('/inventory?q=++x++'));
  const input = screen.getByRole('textbox');
  expect(state.boundaries.at(-1)).toMatchObject({
    name: 'inventory-title-proof-content',
    share: 'route-content',
    update: 'none',
    default: 'none',
  });
  page.rerender(fixture('/inventory?q=x'));
  expect(state.boundaries.at(-1)?.name).toBeUndefined();
  expect(state.boundaries.at(-1)?.share).toBe('none');
  expect(screen.getByRole('textbox')).toBe(input);
  state.enabled = false;
  page.rerender(fixture('/inventory?q=++x++'));
  expect(state.boundaries.at(-1)?.name).toBeUndefined();
  expect(input).toHaveValue('draft');
  state.enabled = true;
  state.current = false;
  page.rerender(fixture('/inventory?q=++x++'));
  expect(state.boundaries.at(-1)?.share).toBe('none');
});

it('inherits the original source denial lease through body capture and releases only at native cleanup', () => {
  const lifetime = createRoutePresentationLifetime(),
    source = Symbol('page');
  const unmount = lifetime.mount(source);
  const ticket = lifetime.capture(
    source,
    () => true,
    () => true,
  )!;
  render(
    <RoutePresentationLifetimeContext value={lifetime}>
      <RoutePresentationSourceContext value={source}>
        <RouteContentIdentityContext value={identity('/inventory?q=++x++')}>
          <PairedInventoryContent enabled>
            <p>Source body</p>
          </PairedInventoryContent>
        </RouteContentIdentityContext>
      </RoutePresentationSourceContext>
    </RoutePresentationLifetimeContext>,
  );
  expect(ticket.current()).toBe(true); // No competing source was mounted.
  lifetime.navigation();
  const callback = state.boundaries.at(-1)!.onShare!;
  const cancelGeometry = vi.fn(() => expect(ticket.current()).toBe(true));
  vi.mocked(routeContentMotion).mockImplementationOnce((_instance, valid) => {
    expect(valid()).toBe(true);
    // Exact approval is registered before the source handoff. Its deferred
    // completion collector runs after these synchronous geometry replacements.
    expect(state.finish).toHaveBeenCalledWith({
      name: 'inventory-title-proof-content',
    });
    return cancelGeometry;
  });
  let cleanup: unknown;
  act(() => {
    cleanup = callback({ name: 'inventory-title-proof-content' } as never, []);
  });
  expect(state.finish).toHaveBeenCalledWith({
    name: 'inventory-title-proof-content',
  });
  expect(routeContentMotion).toHaveBeenCalledWith(
    { name: 'inventory-title-proof-content' },
    expect.any(Function),
    expect.any(Function),
  );
  expect(ticket.current()).toBe(true);
  expect(cleanup).toEqual(expect.any(Function));
  act(() => {
    if (typeof cleanup === 'function') cleanup();
  });
  expect(ticket.current()).toBe(false);
  expect(cancelGeometry).toHaveBeenCalledOnce();
  const next = lifetime.capture(
    source,
    () => true,
    () => true,
  )!;
  act(() => {
    callback({ name: 'inventory-title-proof-content' } as never, []);
  });
  expect(next.current()).toBe(true); // The old exit cannot retire a renewed source.
  next.release();
  ticket.release();
  unmount();
});

it('rejects unrelated or retired callbacks before acquiring a source handoff', () => {
  render(
    <RouteContentIdentityContext value={identity('/inventory/quantity/one')}>
      <PairedInventoryContent enabled>
        <p>Body</p>
      </PairedInventoryContent>
    </RouteContentIdentityContext>,
  );
  const callback = state.boundaries.at(-1)!.onShare!;
  callback({ name: 'different-content' } as never, []);
  state.current = false;
  callback({ name: 'inventory-title-proof-content' } as never, []);
  expect(state.finish).not.toHaveBeenCalled();
  expect(routeContentMotion).not.toHaveBeenCalled();
});

it('rejects withdrawn exact approval before acquiring a source lease or replacing geometry', () => {
  const lifetime = createRoutePresentationLifetime();
  const source = Symbol('withdrawn-pair');
  const unmount = lifetime.mount(source);
  const handoff = vi.spyOn(lifetime, 'handoff');
  render(
    <RoutePresentationLifetimeContext value={lifetime}>
      <RoutePresentationSourceContext value={source}>
        <RouteContentIdentityContext value={identity('/inventory?q=++x++')}>
          <PairedInventoryContent enabled>
            <input aria-label="Retained withdrawn draft" defaultValue="draft" />
          </PairedInventoryContent>
        </RouteContentIdentityContext>
      </RoutePresentationSourceContext>
    </RoutePresentationLifetimeContext>,
  );
  const draft = screen.getByRole('textbox');
  state.finish.mockReturnValueOnce(false);
  const cleanup = state.boundaries.at(-1)!.onShare!(
    { name: 'inventory-title-proof-content' } as never,
    [],
  );
  expect(state.finish).toHaveBeenCalledOnce();
  expect(handoff).not.toHaveBeenCalled();
  expect(routeContentMotion).not.toHaveBeenCalled();
  expect(cleanup).toBeUndefined();
  expect(screen.getByRole('textbox')).toBe(draft);
  expect(draft).toHaveValue('draft');
  unmount();
  handoff.mockRestore();
});

it('shares the body and fades unmatched header/task regions while retaining all exact source leases', () => {
  const lifetime = createRoutePresentationLifetime(),
    source = Symbol('regions');
  const unmount = lifetime.mount(source);
  let owner = true;
  const ticket = lifetime.capture(
    source,
    () => owner,
    () => true,
  )!;
  render(
    <RoutePresentationLifetimeContext value={lifetime}>
      <RoutePresentationSourceContext value={source}>
        <RouteContentIdentityContext
          value={identity('/inventory/quantity/one')}
        >
          {(['header', 'body', 'task-launcher'] as const).map((region) => (
            <PairedInventoryContent
              key={region}
              enabled
              region={region}
              wrap={false}
            >
              <section>{region}</section>
            </PairedInventoryContent>
          ))}
        </RouteContentIdentityContext>
      </RoutePresentationSourceContext>
    </RoutePresentationLifetimeContext>,
  );
  const regions = state.boundaries.slice(-3);
  expect(regions.map((region) => region.name)).toEqual([
    'inventory-title-proof-content-header',
    'inventory-title-proof-content',
    'inventory-title-proof-content-task-launcher',
  ]);
  expect(
    regions.every(
      (region) =>
        region.share === 'route-content' &&
        region.enter === 'route-content' &&
        region.exit === 'route-content',
    ),
  ).toBe(true);
  lifetime.navigation();
  owner = false;
  const finishes = regions.map((region, index) =>
    (index === 1 ? region.onShare : region.onExit)!(
      { name: region.name! } as never,
      [],
    ),
  );
  expect(finishes.every((finish) => typeof finish === 'function')).toBe(true);
  for (const finish of finishes.slice(0, -1)) {
    if (typeof finish === 'function') finish();
    expect(ticket.current()).toBe(true);
  }
  const final = finishes.at(-1);
  if (typeof final === 'function') final();
  expect(ticket.current()).toBe(false);
  unmount();
});

it('rejects an old exact primary callback before acquiring the renewed source exit lease', () => {
  const lifetime = createRoutePresentationLifetime(),
    source = Symbol('primary');
  const unmount = lifetime.mount(source);
  const handoff = vi.spyOn(lifetime, 'handoff');
  state.primary = {
    name: 'route-primary-first',
    presentation: 'primary',
    sourceKey: '/inventory?q=++x++',
    destinationKey: '/history',
    epoch: 0,
  };
  const fixture = () => (
    <RoutePresentationLifetimeContext value={lifetime}>
      <RoutePresentationSourceContext value={source}>
        <RouteContentIdentityContext value={identity('/inventory?q=++x++')}>
          <PairedInventoryContent enabled conventionalPrimary>
            <input aria-label="Retained primary draft" defaultValue="draft" />
          </PairedInventoryContent>
        </RouteContentIdentityContext>
      </RoutePresentationSourceContext>
    </RoutePresentationLifetimeContext>
  );
  const view = render(fixture());
  const first = state.boundaries.at(-1)!.onShare!;
  const draft = screen.getByRole('textbox');
  state.primary = { ...state.primary, name: 'route-primary-next' };
  view.rerender(fixture());
  act(() => {
    first({ name: 'route-primary-first' } as never, []);
  });
  expect(handoff).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox')).toBe(draft);
  act(() => {
    state.boundaries.at(-1)!.onShare!(
      { name: 'route-primary-next' } as never,
      [],
    );
  });
  expect(handoff).toHaveBeenCalledTimes(1);
  unmount();
  handoff.mockRestore();
});
