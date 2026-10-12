import { expect, it, vi } from 'vitest';
import { replaceAppHistoryUrl } from './history';

it('omits Next bypass markers while preserving user state for the native router wrapper', () => {
  window.history.replaceState(
    {
      __NA: true,
      _N: true,
      userState: { retained: 1 },
      __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'],
    },
    '',
    '/inventory/quantity/record?task=quantity_move&returnTo=%2Finventory#tasks',
  );
  const original = window.history.replaceState.bind(window.history);
  const synchronize = vi.fn();
  // Match the installed Next native-history wrapper's bypass condition.
  const wrapper = vi
    .spyOn(window.history, 'replaceState')
    .mockImplementation((data: Record<string, unknown>, unused, url) => {
      if (!data.__NA && !data._N) synchronize(url);
      original(
        {
          ...data,
          __NA: true,
          __PRIVATE_NEXTJS_INTERNALS_TREE:
            window.history.state.__PRIVATE_NEXTJS_INTERNALS_TREE,
        },
        unused,
        url,
      );
    });
  try {
    replaceAppHistoryUrl(
      '/inventory/quantity/record?returnTo=%2Finventory#tasks',
    );
    expect(synchronize).toHaveBeenCalledWith(
      '/inventory/quantity/record?returnTo=%2Finventory#tasks',
    );
    expect(window.history.state).toMatchObject({
      __NA: true,
      userState: { retained: 1 },
      __PRIVATE_NEXTJS_INTERNALS_TREE: ['tree'],
    });
  } finally {
    wrapper.mockRestore();
  }
});
