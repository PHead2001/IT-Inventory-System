import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
vi.mock('@/features/room/spaces-workspace', () => ({
  SpacesWorkspace: ({ initialSpace }: { initialSpace: { name: string } }) => (
    <p>{initialSpace.name}</p>
  ),
}));
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
