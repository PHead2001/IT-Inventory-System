import { afterEach, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocationPicker } from './location-picker';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  invalidateAssignmentPrivacy,
  invalidateAssignmentCallbacks,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '../scan/assign-batch';
import type { LocationRef } from '../inventory/contracts-ui';
const chunks = vi.hoisted(() => ({
  pending: false,
  failed: false,
  captured: null as null | {
    onUse(code: string): void;
    onClose(): void;
    onMounted?(): void;
  },
}));
afterEach(() => {
  chunks.pending = false;
  chunks.failed = false;
});
vi.mock('next/dynamic', () => {
  function Loaded(props: {
    onUse(code: string): void;
    onClose(): void;
    onMounted?(): void;
  }) {
    const { onMounted } = props;
    useLayoutEffect(() => {
      onMounted?.();
    }, [onMounted]);
    return (
      <div>
        <input
          aria-label="Staged map draft"
          defaultValue="Original candidate"
        />
        <button type="button" onClick={() => props.onUse('ITC-D01')}>
          Use staged drawer
        </button>
        <button type="button" onClick={props.onClose}>
          Cancel map
        </button>
      </div>
    );
  }
  return {
    default:
      (_loader: unknown, options: { loading(): import('react').ReactNode }) =>
      (props: {
        onUse(code: string): void;
        onClose(): void;
        onMounted?(): void;
      }) => {
        if (chunks.failed) throw new Error('Map chunk failed');
        chunks.captured = props;
        return chunks.pending ? options.loading() : <Loaded {...props} />;
      },
  };
});
const location: LocationRef = {
  id: 'drawer-uuid',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'Closet / Drawer 1',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
it('a fresh explicit map launch recovers a failed optional region without changing the selected UUID or form draft', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const user = userEvent.setup(),
      change = vi.fn(),
      submit = vi.fn();
    const view = render(
      <form onSubmit={submit}>
        <input aria-label="Reason" defaultValue="Keep this draft" />
        <LocationPicker
          locations={[location]}
          mode="destination"
          label="Destination"
          name="location"
          defaultValue={location.id}
          onValueChange={change}
        />
      </form>,
    );
    chunks.failed = true;
    await user.click(screen.getByRole('button', { name: 'Pick on map' }));
    expect(screen.getByRole('status')).toHaveTextContent('Map unavailable');
    expect(
      new FormData(view.container.querySelector('form')!).get('location'),
    ).toBe(location.id);
    chunks.failed = false;
    await user.click(screen.getByRole('button', { name: 'Pick on map' }));
    expect(
      screen.getByRole('button', { name: 'Use staged drawer' }),
    ).toBeVisible();
    expect(
      screen.queryByText('Map unavailable. Choose a location in the browser.'),
    ).toBeNull();
    expect(screen.getByLabelText('Reason')).toHaveValue('Keep this draft');
    expect(
      new FormData(view.container.querySelector('form')!).get('location'),
    ).toBe(location.id);
    expect(change).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel map' }));
    expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveFocus();
  } finally {
    error.mockRestore();
  }
});
it('map and tree fill the same UUID successful control without submitting or discarding other fields', async () => {
  const user = userEvent.setup(),
    change = vi.fn(),
    submit = vi.fn();
  const props = {
    locations: [location],
    mode: 'destination' as const,
    label: 'Destination',
    name: 'location',
    onValueChange: change,
  };
  const view = render(
    <form onSubmit={submit}>
      <input aria-label="Reason" defaultValue="Keep this draft" />
      <LocationPicker {...props} />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  await user.click(screen.getByRole('button', { name: 'Cancel map' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Reason')).toHaveValue('Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).toHaveBeenLastCalledWith(location.id);
  expect(
    new FormData(view.container.querySelector('form')!).get('location'),
  ).toBe(location.id);
  expect(submit).not.toHaveBeenCalled();
  view.unmount();
  render(<LocationPicker {...props} />);
  await user.click(screen.getByRole('combobox', { name: 'Destination' }));
  await user.click(screen.getByRole('treeitem', { name: /Drawer 1/ }));
  expect(change).toHaveBeenLastCalledWith(location.id);
});
it('confirmation rechecks refreshed eligibility and parent pending state', async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  const props = {
    locations: [location],
    mode: 'destination' as const,
    label: 'Destination',
    onValueChange: change,
  };
  const view = render(<LocationPicker {...props} />);
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  view.rerender(<LocationPicker {...props} excludeIds={[location.id]} />);
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).not.toHaveBeenCalled();
  view.rerender(<LocationPicker {...props} disabled />);
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).not.toHaveBeenCalled();
});

it('announces a cold map request immediately and cancels without a later dialog or lost draft', async () => {
  chunks.pending = true;
  const user = userEvent.setup(),
    change = vi.fn(),
    submit = vi.fn();
  const props = {
    locations: [location],
    mode: 'destination' as const,
    label: 'Destination',
    onValueChange: change,
  };
  const view = render(
    <form onSubmit={submit}>
      <input aria-label="Reason" defaultValue="Keep this draft" />
      <LocationPicker {...props} />
    </form>,
  );
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  expect(screen.getByRole('status')).toHaveTextContent('Loading map');
  expect(
    screen.getByRole('status').closest('[aria-busy="true"]'),
  ).not.toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Use staged drawer' }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cancel map loading' }));
  expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveFocus();
  chunks.pending = false;
  view.rerender(
    <form onSubmit={submit}>
      <input aria-label="Reason" defaultValue="Keep this draft" />
      <LocationPicker {...props} />
    </form>,
  );
  expect(
    screen.queryByRole('button', { name: 'Use staged drawer' }),
  ).toBeNull();
  expect(screen.getByLabelText('Reason')).toHaveValue('Keep this draft');
  expect(change).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  expect(
    screen.getByRole('button', { name: 'Use staged drawer' }),
  ).toBeVisible();
});

const grant = (generation: string, ready = true) => ({
  generation,
  ready,
  visible: true,
  revocationRevision: readPrivacyRevocationRevision(),
  verifiedEpoch: ready ? assignmentEpoch() : undefined,
});
it.each(['replacement', 'revocation', 'cleanup', 'assignment'] as const)(
  'retires cold intent after %s and fences stale callbacks even after new explicit activation',
  async (kind) => {
    const user = userEvent.setup(),
      change = vi.fn();
    chunks.pending = true;
    const ui = (generation = 'actor-a') => (
      <PrivacyReadinessContext value={grant(generation)}>
        <input aria-label="Unrelated control" />
        <LocationPicker
          locations={[location]}
          mode="destination"
          label="Destination"
          onValueChange={change}
        />
      </PrivacyReadinessContext>
    );
    const view = render(ui());
    await user.click(screen.getByRole('button', { name: 'Pick on map' }));
    const old = chunks.captured!;
    screen.getByLabelText('Unrelated control').focus();
    if (kind === 'replacement') {
      view.rerender(ui('actor-b'));
      view.rerender(ui());
    } else if (kind === 'cleanup') {
      act(() => expect(invalidateAssignmentPrivacy(true, false)).toBe(true));
      view.rerender(ui());
    } else if (kind === 'assignment') {
      act(() => invalidateAssignmentCallbacks());
      view.rerender(ui());
    } else {
      act(() => revokePrivatePresentation());
      view.rerender(ui());
    }
    chunks.pending = false;
    view.rerender(ui());
    expect(
      screen.queryByRole('button', { name: 'Use staged drawer' }),
    ).toBeNull();
    act(() => {
      old.onMounted?.();
      old.onUse(location.code);
      old.onClose();
    });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Unrelated control')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Pick on map' }));
    act(() => {
      old.onUse(location.code);
      old.onClose();
    });
    expect(
      screen.getByRole('button', { name: 'Use staged drawer' }),
    ).toBeVisible();
    expect(change).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
    expect(change).toHaveBeenCalledExactlyOnceWith(location.id);
  },
);
it('retains a pending original intent through ordinary same-authority recheck but waits for a fresh grant before delayed mounting or Use', async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  chunks.pending = true;
  const ui = (ready = true) => (
    <PrivacyReadinessContext value={grant('actor-a', ready)}>
      <LocationPicker
        locations={[location]}
        mode="destination"
        label="Destination"
        onValueChange={change}
      />
    </PrivacyReadinessContext>
  );
  const view = render(ui());
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  const pending = chunks.captured!;
  view.rerender(ui(false));
  chunks.pending = false;
  view.rerender(ui(false));
  expect(screen.getByRole('status')).toHaveTextContent('Loading map');
  expect(
    screen.queryByRole('button', { name: 'Use staged drawer' }),
  ).toBeNull();
  act(() => pending.onUse(location.code));
  expect(change).not.toHaveBeenCalled();
  view.rerender(ui());
  expect(
    screen.getByRole('button', { name: 'Use staged drawer' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(location.id);
});

it('keeps an already mounted original dialog during ordinary recheck while fencing Use and focus until fresh', async () => {
  const user = userEvent.setup(),
    change = vi.fn();
  const ui = (ready = true) => (
    <PrivacyReadinessContext value={grant('actor-a', ready)}>
      <input aria-label="Unrelated control" />
      <LocationPicker
        locations={[location]}
        mode="destination"
        label="Destination"
        onValueChange={change}
      />
    </PrivacyReadinessContext>
  );
  const view = render(ui());
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  act(() => chunks.captured!.onMounted?.());
  view.rerender(ui(false));
  expect(
    screen.getByRole('button', { name: 'Use staged drawer' }),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).not.toHaveBeenCalled();
  view.rerender(ui());
  await user.click(screen.getByRole('button', { name: 'Use staged drawer' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(location.id);
  expect(screen.getByRole('combobox', { name: 'Destination' })).toHaveFocus();
});

it('cannot mint a cold intent from a retained activation handler after live invalidation', async () => {
  chunks.pending = true;
  const user = userEvent.setup();
  const ui = () => (
    <PrivacyReadinessContext value={grant('actor-a')}>
      <LocationPicker
        locations={[location]}
        mode="destination"
        label="Destination"
      />
    </PrivacyReadinessContext>
  );
  const view = render(ui());
  const trigger = screen.getByRole('button', { name: 'Pick on map' });
  act(() => {
    invalidateAssignmentCallbacks();
    fireEvent.click(trigger);
  });
  view.rerender(ui());
  chunks.pending = false;
  view.rerender(ui());
  expect(
    screen.queryByRole('button', { name: 'Use staged drawer' }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  expect(
    screen.getByRole('button', { name: 'Use staged drawer' }),
  ).toBeVisible();
});
it('acknowledges child layout mounting with the fresh committed render and preserves its candidate through the next recheck', async () => {
  chunks.pending = true;
  const user = userEvent.setup();
  const ui = (ready = true) => (
    <PrivacyReadinessContext value={grant('actor-a', ready)}>
      <LocationPicker
        locations={[location]}
        mode="destination"
        label="Destination"
      />
    </PrivacyReadinessContext>
  );
  const view = render(ui());
  await user.click(screen.getByRole('button', { name: 'Pick on map' }));
  view.rerender(ui(false));
  chunks.pending = false;
  view.rerender(ui(false));
  view.rerender(ui());
  const draft = screen.getByLabelText('Staged map draft');
  await user.clear(draft);
  await user.type(draft, 'Keep staged candidate');
  view.rerender(ui(false));
  expect(screen.getByLabelText('Staged map draft')).toHaveValue(
    'Keep staged candidate',
  );
});
