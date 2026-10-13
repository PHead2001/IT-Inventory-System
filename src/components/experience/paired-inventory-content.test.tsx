import { act, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ViewTransitionProps } from 'react';
import { PairedInventoryContent } from './paired-inventory-content';
import { RouteContentIdentityContext } from './route-content-identity';
import {
  RoutePresentationLifetimeContext,
  RoutePresentationSourceContext,
} from './route-presentation-source';
import { createRoutePresentationLifetime } from './route-presentation-lifetime';

const state = vi.hoisted(() => ({
  boundaries: [] as ViewTransitionProps[],
  enabled: true,
  current: true,
  finish: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('./route-motion', () => ({
  useRouteMotion: () => ({
    enabled: state.enabled,
    current: () => state.current,
    intent: {
      name: 'inventory-title-proof',
      kind: 'quantity',
      id: 'one',
      detailPath: '/inventory/quantity/one',
      listHref: '/inventory?q=x',
      rawSourceRouteKey: '/inventory?q=++x++',
    },
    titleArrival: state.enabled
      ? {
          sourceKey: '/inventory?q=++x++',
          destinationKey: '/inventory/quantity/one',
          epoch: 1,
        }
      : null,
    cancelIfInvalid: state.cancel,
    finishPairedContentAfterSnapshot: state.finish,
  }),
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
  let cleanup: unknown;
  act(() => {
    cleanup = callback({ name: 'inventory-title-proof-content' } as never, []);
  });
  expect(state.finish).toHaveBeenCalledWith({
    name: 'inventory-title-proof-content',
  });
  expect(ticket.current()).toBe(true);
  expect(cleanup).toEqual(expect.any(Function));
  act(() => {
    if (typeof cleanup === 'function') cleanup();
  });
  expect(ticket.current()).toBe(false);
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
});
