import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ViewTransitionProps } from 'react';
import { createAuxiliaryRouteCapture } from './auxiliary-route-capture';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import {
  InventoryCaptureRegion,
  InventoryCaptureRegionsContext,
} from './inventory-capture-region';
import { RouteContentIdentityContext } from './route-content-identity';
import { RoutePresentationSourceContext } from './route-presentation-source';

const state = vi.hoisted(() => ({
  boundaries: [] as ViewTransitionProps[],
  primary: false,
  enabled: true,
}));
vi.mock('./route-motion', () => ({
  useRouteMotion: () => ({
    validNow: () => state.enabled,
    current: () => true,
    captureAvailable: true,
    enabled: state.enabled,
    intent: null,
    titleArrival: null,
    arrival: state.primary
      ? {
          name: 'route-primary-proof',
          presentation: 'primary',
          sourceKey: '/inventory',
          destinationKey: '/history',
          epoch: 1,
        }
      : null,
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
  state.primary = false;
  state.enabled = true;
});

it('retains a real primary boundary with auxiliary support without remounting authored DOM or arming it for title pairs', () => {
  const registry = createAuxiliaryRouteCapture();
  const source = Symbol();
  const fixture = () => (
    <AuxiliaryRouteCaptureContext value={registry}>
      <InventoryCaptureRegionsContext
        value={{
          enabled: true,
          pairedInventory: true,
          conventionalPrimary: true,
        }}
      >
        <RoutePresentationSourceContext value={source}>
          <RouteContentIdentityContext
            value={{
              pathname: '/inventory',
              listHref: '/inventory',
              rawRouteKey: '/inventory',
            }}
          >
            <InventoryCaptureRegion region="body">
              <input aria-label="Retained primary draft" defaultValue="draft" />
            </InventoryCaptureRegion>
          </RouteContentIdentityContext>
        </RoutePresentationSourceContext>
      </InventoryCaptureRegionsContext>
    </AuxiliaryRouteCaptureContext>
  );
  const page = render(fixture());
  const input = screen.getByRole('textbox');
  expect(state.boundaries.at(-1)?.name).toBeUndefined();
  state.primary = true;
  page.rerender(fixture());
  expect(state.boundaries.at(-1)).toMatchObject({
    name: 'route-primary-proof',
    share: 'route-content',
    enter: 'route-content',
    exit: 'route-content',
  });
  state.primary = false;
  page.rerender(fixture());
  expect(state.boundaries.at(-1)?.name).toBeUndefined();
  state.primary = true;
  state.enabled = false;
  page.rerender(fixture());
  expect(state.boundaries.at(-1)?.name).toBeUndefined();
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input).toHaveValue('draft');
});

it.each([
  ['header', true, true],
  ['body', true, true],
  ['header', true, false],
  ['body', true, false],
  ['header', false, true],
  ['body', false, true],
] as const)(
  'requires the exact server route key for %s and retires participation when that identity is withdrawn (paired=%s, conventional=%s)',
  (region, pairedInventory, conventionalPrimary) => {
    const registry = createAuxiliaryRouteCapture();
    const register = vi.spyOn(registry, 'register');
    const arm = vi.spyOn(registry, 'arm');
    const source = Symbol();
    const fixture = (rawRouteKey?: string) => (
      <AuxiliaryRouteCaptureContext value={registry}>
        <InventoryCaptureRegionsContext
          value={{
            enabled: true,
            pairedInventory,
            conventionalPrimary,
          }}
        >
          <RoutePresentationSourceContext value={source}>
            <RouteContentIdentityContext
              value={{
                pathname: '/inventory',
                listHref: '/inventory',
                rawRouteKey,
              }}
            >
              <InventoryCaptureRegion region={region}>
                <header>Record description</header>
              </InventoryCaptureRegion>
            </RouteContentIdentityContext>
          </RoutePresentationSourceContext>
        </InventoryCaptureRegionsContext>
      </AuxiliaryRouteCaptureContext>
    );
    const page = render(fixture());
    const header = screen.getByText('Record description');
    expect(register).not.toHaveBeenCalled();
    page.rerender(fixture('/inventory?q=++USB++'));
    const participant = register.mock.calls.at(-1)![0];
    expect(participant.routeKey).toBe('/inventory?q=++USB++');
    expect(participant.source).toBe(source);
    expect(participant.region).toBe(region);
    expect(header).toHaveAttribute('data-route-capture-region', region);
    expect(participant.current()).toBe(true);
    page.rerender(fixture());
    expect(participant.current()).toBe(false);
    expect(arm).not.toHaveBeenCalled();
    expect(screen.getByText('Record description')).toBe(header);
    expect(
      register.mock.calls.every(
        ([entry]) => typeof entry.routeKey === 'string',
      ),
    ).toBe(true);
  },
);
