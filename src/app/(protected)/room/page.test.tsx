vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({
    url: 'https://backend.example',
    key: 'public-test',
  }),
}));
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/session.server', () => ({
  requireMember: async () => ({ member: { user_id: 'PRIVATE_ACTOR' } }),
}));
vi.mock('@/features/inventory/queries.server', () => ({
  getLocations: async () => [{ code: 'PRIVATE-CODE' }],
}));
vi.mock('@/features/room/spaces', () => ({
  availableSpaces: () => [{ id: 'private-space' }],
  resolveSpace: () => ({ id: 'private-space', name: 'Private physical space' }),
  spaceLocations: () => [{ code: 'PRIVATE-CODE' }],
}));
const mocks = vi.hoisted(() => ({ workspace: vi.fn() }));
vi.mock('@/features/room/spaces-workspace', () => ({
  SpacesWorkspace: (props: {
    initialSpace: { name: string };
    backend: string;
  }) => {
    mocks.workspace(props);
    return <p>{props.initialSpace.name}</p>;
  },
}));
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import { RouteReadyContext } from '@/components/experience/route-ready';
import { createRouteReadiness } from '@/components/experience/route-readiness';
import { createRoutePendingState } from '@/components/experience/route-pending-state';
import * as route from './page';
it('identifies Spaces & maps while keeping selected location and private space names out of metadata', async () => {
  render(
    await route.default({
      searchParams: Promise.resolve({
        space: 'private-space',
        location: 'PRIVATE-CODE',
      }),
    }),
  );
  expect(screen.getByRole('heading', { name: 'Spaces & maps' })).toBeVisible();
  expect(screen.getByText('Private physical space')).toBeVisible();
  expect(route.metadata.title).toBe('Spaces & maps');
  expect(JSON.stringify(route.metadata)).not.toMatch(
    /PRIVATE|private-space|Private physical space/,
  );
});

it('withholds the workspace until privacy readiness, then passes the public backend binding', async () => {
  const page = await route.default({
    searchParams: Promise.resolve({
      space: 'private-space',
      location: 'PRIVATE-CODE',
    }),
  });
  const { rerender } = render(
    <PrivacyReadinessContext.Provider
      value={{ ready: false, visible: false, generation: 'checking' }}
    >
      {page}
    </PrivacyReadinessContext.Provider>,
  );
  expect(mocks.workspace).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('heading', { name: 'Spaces & maps' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Private physical space')).not.toBeInTheDocument();
  rerender(
    <PrivacyReadinessContext.Provider
      value={{ ready: true, visible: true, generation: 'accepted' }}
    >
      {page}
    </PrivacyReadinessContext.Provider>,
  );
  expect(screen.getByText('Private physical space')).toBeVisible();
  expect(mocks.workspace).toHaveBeenLastCalledWith(
    expect.objectContaining({
      backend: 'https://backend.example',
      userId: 'PRIVATE_ACTOR',
      initialCode: 'PRIVATE-CODE',
    }),
  );
});

it('does not acknowledge selected-location contents through the outer server shell', async () => {
  const pending = createRoutePendingState();
  const committed = vi.fn();
  const readiness = createRouteReadiness('PRIVATE_ACTOR', pending, committed);
  history.replaceState(
    null,
    '',
    '/room?location=PRIVATE-CODE&space=private-space',
  );
  const geometry = vi
    .spyOn(HTMLElement.prototype, 'getClientRects')
    .mockReturnValue([{ width: 30, height: 20 }] as unknown as DOMRectList);
  try {
    readiness.history();
    render(
      <RouteReadyContext value={readiness}>
        {await route.default({
          searchParams: Promise.resolve({
            space: 'private-space',
            location: 'PRIVATE-CODE',
          }),
        })}
      </RouteReadyContext>,
    );
    expect(
      screen.getByRole('heading', { name: 'Spaces & maps' }),
    ).toBeVisible();
    expect(mocks.workspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialRouteKey: '/room?location=PRIVATE-CODE&space=private-space',
      }),
    );
    expect(committed).not.toHaveBeenCalled();
    expect(pending.snapshot().pending).toBe(true);
  } finally {
    geometry.mockRestore();
    history.replaceState(null, '', '/');
  }
});
