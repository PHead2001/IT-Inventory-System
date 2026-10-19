import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactNode } from 'react';
import { RouteReady } from './route-ready';
import { InventoryBackLink, InventoryRecordLink } from './record-transition';
import { titleTarget, type TitleIntent } from './route-motion-state';

const presentation = vi.hoisted(() => ({
  intent: null as TitleIntent | null,
  boundaries: [] as Array<{ share?: string; name?: string }>,
  arm: vi.fn(),
  armBack: vi.fn(),
}));
vi.mock('./route-motion', () => ({
  useRouteMotion: () => ({
    intent: presentation.intent,
    listHref: '/inventory',
    arm: presentation.arm,
    armBack: presentation.armBack,
    registerReturnSource: () => () => {},
    retireTitle: vi.fn(),
    current: () => true,
    validNow: () => true,
    finishTitleAfterSnapshot: vi.fn(),
  }),
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  ViewTransition: ({
    children,
    ...props
  }: {
    children: ReactNode;
    share?: string;
    name?: string;
  }) => {
    presentation.boundaries.push(props);
    return children;
  },
}));
vi.mock('./route-link', () => ({
  default: ({
    children,
    onNavigate,
    ...props
  }: ComponentProps<'a'> & { onNavigate?: () => void }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
    >
      {children}
    </a>
  ),
}));

const record = { kind: 'quantity' as const, id: 'cable' };
const holding = { domain: 'storage' as const, id: 'shelf' };
beforeEach(() => {
  presentation.intent = null;
  presentation.boundaries.length = 0;
  presentation.arm.mockImplementation((target) => {
    presentation.intent = { ...target, name: 'paired-title' };
  });
  presentation.armBack.mockImplementation((identity, href) => {
    presentation.intent = {
      ...titleTarget(identity, href, holding)!,
      name: 'paired-title',
    };
  });
});

it.each([
  ['/inventory?type=all', '/inventory'],
  ['/inventory?status=active', '/inventory'],
  ['/inventory?q=++USB++', '/inventory?q=USB'],
  ['/inventory?scopeAdjusted=true', '/inventory'],
])(
  'keeps forward and Back title eligibility for canonical results from %s',
  (raw, canonical) => {
    // Captured boundary intent is component proof only. Native animation/privacy
    // remain covered by their real-provider and production browser suites.
    const anchor = canonical + '#inventory-row-1';
    const list = (pairingHref?: string) => (
      <RouteReady
        actorId="actor"
        routeKey={raw}
        contentIdentity="inventory"
        pairingHref={pairingHref}
      >
        <div id="inventory-row-1">
          <InventoryRecordLink
            record={record}
            holding={holding}
            returnTo={anchor}
            href="/inventory/quantity/cable"
          >
            Cable
          </InventoryRecordLink>
        </div>
      </RouteReady>
    );
    const view = render(list());
    fireEvent.click(screen.getByRole('link', { name: 'Cable' }));
    expect(presentation.arm.mock.calls.at(-1)?.[0].rawSourceRouteKey).toBe(raw);
    view.rerender(list());
    expect(presentation.boundaries.at(-1)?.share).toBe('none');
    view.rerender(list(canonical));
    expect(presentation.boundaries.at(-1)).toMatchObject({
      share: 'record-title',
      name: 'paired-title',
    });
    view.rerender(
      <RouteReady
        actorId="actor"
        routeKey="/inventory/quantity/cable"
        contentIdentity="detail"
      >
        <InventoryBackLink record={record} href={anchor}>
          Back to results
        </InventoryBackLink>
      </RouteReady>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Back to results' }));
    view.rerender(list(canonical));
    expect(presentation.armBack).toHaveBeenLastCalledWith(record, anchor);
    expect(presentation.boundaries.at(-1)).toMatchObject({
      share: 'record-title',
      name: 'paired-title',
    });
    view.rerender(list('/inventory?type=asset'));
    expect(presentation.boundaries.at(-1)?.share).toBe('none');
  },
);
