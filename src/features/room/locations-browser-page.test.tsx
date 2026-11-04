import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import {
  emptyLocationBrowserState,
  locationBrowserHref,
} from './location-browser-state';
import { LocationsBrowserPage } from './locations-browser-page';

const runtime = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: runtime.replace }),
}));
afterEach(() => vi.useRealTimers());

it('an actual over-budget expansion keeps its notice in the browser column and preserves the mounted selected panel', () => {
  vi.useFakeTimers();
  runtime.replace.mockClear();
  const locations = Array.from({ length: 33 }, (_, index) => {
    const parent = {
      id: `group-${index}`,
      code: `GROUP-${index}`,
      name: `Group ${index}`,
      breadcrumb: `Storage / Group ${index}`,
      parentId: null,
      active: true,
      can_hold_inventory: false,
    };
    return [
      parent,
      {
        ...parent,
        id: `child-${index}`,
        code: `GROUP-${index}-CHILD`,
        name: `Child ${index}`,
        breadcrumb: `${parent.breadcrumb} / Child ${index}`,
        parentId: parent.id,
        can_hold_inventory: true,
      },
    ];
  }).flat();
  const initial = {
    ...emptyLocationBrowserState(),
    selectedCode: 'GROUP-0-CHILD',
  };
  const rawKey = locationBrowserHref(initial);
  history.replaceState(null, '', rawKey);
  render(
    <PrivacyReadinessContext
      value={{
        ready: true,
        visible: true,
        generation: 'verified',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <LocationsBrowserPage
        locations={locations}
        initialState={initial}
        rawRouteKey={rawKey}
      />
    </PrivacyReadinessContext>,
  );
  const browser = screen.getByRole('navigation', { name: 'Location browser' });
  const panel = screen.getByRole('region', { name: 'Selected location' });
  const column = browser.parentElement!;
  const grid = column.parentElement!;
  expect(column.nextElementSibling).toBe(panel);
  expect(grid.children).toHaveLength(2);
  // Keep each real click/render, but resolve the stable controls once rather
  // than repeating an accessibility walk over the growing tree 33 times.
  const expandButtons = new Map(
    screen
      .getAllByRole('button', { name: /^Expand Group \d+$/ })
      .map((button) => [button.getAttribute('aria-label'), button]),
  );
  expect(expandButtons.size).toBe(33);
  for (let index = 0; index < 32; index++)
    fireEvent.click(expandButtons.get(`Expand Group ${index}`)!);
  const acceptedHref = runtime.replace.mock.calls.at(-1)![0];
  fireEvent.click(expandButtons.get('Expand Group 32')!);
  act(() => vi.advanceTimersByTime(1000));
  const notice = screen.getByText(
    /This view has reached its saved-state limit/,
  );
  expect(notice.parentElement).toBe(column);
  expect(column.nextElementSibling).toBe(panel);
  expect(grid.children).toHaveLength(2);
  expect(screen.getByRole('region', { name: 'Selected location' })).toBe(panel);
  expect(panel).toHaveTextContent('Child 0');
  expect(runtime.replace).toHaveBeenCalledTimes(32);
  expect(runtime.replace).toHaveBeenLastCalledWith(acceptedHref, {
    scroll: false,
  });
});
