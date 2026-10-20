import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createAuxiliaryRouteCapture } from './auxiliary-route-capture';
import { AuxiliaryRouteCaptureContext } from './auxiliary-route-context';
import {
  InventoryCaptureRegion,
  InventoryCaptureRegionsContext,
} from './inventory-capture-region';
import { RouteContentIdentityContext } from './route-content-identity';
import { RoutePresentationSourceContext } from './route-presentation-source';

vi.mock('./route-motion', () => ({
  useRouteMotion: () => ({ validNow: () => true, captureAvailable: true }),
}));

it.each(['header', 'body'] as const)(
  'requires the exact server route key for %s and retires participation when that identity is withdrawn',
  (region) => {
    const registry = createAuxiliaryRouteCapture();
    const register = vi.spyOn(registry, 'register');
    const source = Symbol();
    const fixture = (rawRouteKey?: string) => (
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
    expect(screen.getByText('Record description')).toBe(header);
    expect(
      register.mock.calls.every(
        ([entry]) => typeof entry.routeKey === 'string',
      ),
    ).toBe(true);
  },
);
