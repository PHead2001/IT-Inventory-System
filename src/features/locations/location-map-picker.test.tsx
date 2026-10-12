import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LocationMapPicker from './location-map-picker';
import { revokePrivatePresentation } from '../scan/assign-batch';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '../scan/assign-batch';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import type { LocationRef } from '../inventory/contracts-ui';
const driver = vi.hoisted(() => ({
  authority: null as
    import('../room/scene/camera-snapshot-store').CameraAuthority | null,
}));
vi.mock('../room/scene/camera-snapshot-provider', () => ({
  useRoomSceneAuthority: () => driver.authority,
}));
vi.mock('../room/embedded-room', () => ({
  EmbeddedRoom: ({ onSelect }: { onSelect(code: string): void }) => (
    <button type="button" onClick={() => onSelect('ITC-D01')}>
      Stage drawer
    </button>
  ),
}));
const root: LocationRef = {
  id: 'root',
  code: 'ITC',
  name: 'Closet',
  breadcrumb: 'Closet',
  parentId: null,
  active: true,
  can_hold_inventory: false,
};
const drawer: LocationRef = {
  id: 'drawer',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'Closet / Drawer 1',
  parentId: 'root',
  active: true,
  can_hold_inventory: true,
};
beforeEach(() => {
  driver.authority = null;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
it('opens after initial same-owner verification and cannot reopen a cancelled dialog on another readiness cycle', () => {
  const authority = {
    actorId: 'actor-a',
    backend: 'https://backend.example',
    generation: 'verified',
    revision: readPrivacyRevocationRevision(),
    epoch: assignmentEpoch(),
  };
  driver.authority = authority;
  const close = vi.fn();
  const ui = (ready: boolean) => (
    <PrivacyReadinessContext
      value={{
        ready,
        generation: 'verified',
        revocationRevision: authority.revision,
        verifiedEpoch: authority.epoch,
      }}
    >
      <LocationMapPicker
        locations={[root, drawer]}
        initialValue={drawer.id}
        disabled={false}
        onUse={vi.fn()}
        onClose={close}
      />
    </PrivacyReadinessContext>
  );
  const view = render(ui(false));
  const dialog = screen.getByRole('dialog', { hidden: true });
  expect(dialog).not.toHaveAttribute('open');
  view.rerender(ui(true));
  expect(dialog).toHaveAttribute('open');
  expect(dialog).not.toHaveAttribute('hidden');
  view.rerender(ui(false));
  expect(dialog).not.toHaveAttribute('open');
  view.rerender(ui(true));
  expect(dialog).toHaveAttribute('open');
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
  expect(dialog).not.toHaveAttribute('open');
  view.rerender(ui(false));
  view.rerender(ui(true));
  expect(dialog).not.toHaveAttribute('open');
  expect(dialog).toHaveAttribute('hidden');
  expect(dialog).toHaveAttribute('inert');
});
it.each(['actor', 'backend', 'generation'])(
  'preserves ordinary verification but permanently retires %s drift and the staged candidate',
  async (field) => {
    const authority = {
      actorId: 'actor-a',
      backend: 'https://backend.example',
      generation: 'verified',
      revision: readPrivacyRevocationRevision(),
      epoch: assignmentEpoch(),
    };
    driver.authority = authority;
    const use = vi.fn(),
      close = vi.fn();
    const ui = (ready = true, generation = 'verified') => (
      <PrivacyReadinessContext
        value={{
          ready,
          visible: ready,
          generation,
          revocationRevision: authority.revision,
          verifiedEpoch: authority.epoch,
        }}
      >
        <LocationMapPicker
          locations={[root, drawer]}
          initialValue={drawer.id}
          disabled={false}
          onUse={use}
          onClose={close}
        />
      </PrivacyReadinessContext>
    );
    const view = render(ui());
    const button = screen.getByRole('button', { name: 'Use location' });
    view.rerender(ui(false));
    expect(button).toBeDisabled();
    view.rerender(ui());
    expect(button).toBeEnabled();
    driver.authority = {
      ...authority,
      ...(field === 'actor'
        ? { actorId: 'actor-b' }
        : field === 'backend'
          ? { backend: 'https://other.example' }
          : { generation: 'other' }),
    };
    view.rerender(ui(true, field === 'generation' ? 'other' : 'verified'));
    expect(close).toHaveBeenCalledOnce();
    driver.authority = authority;
    view.rerender(ui());
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(use).not.toHaveBeenCalled();
  },
);
it('stages without selecting and refuses a candidate after ancestor deactivation, exclusion or a pending parent', async () => {
  const user = userEvent.setup(),
    use = vi.fn(),
    close = vi.fn();
  const props = {
    locations: [root, drawer],
    initialValue: '',
    disabled: false,
    onUse: use,
    onClose: close,
  };
  const view = render(<LocationMapPicker {...props} />);
  await user.click(screen.getByRole('button', { name: 'Stage drawer' }));
  expect(use).not.toHaveBeenCalled();
  view.rerender(
    <LocationMapPicker
      {...props}
      locations={[{ ...root, active: false }, drawer]}
    />,
  );
  expect(screen.getByRole('button', { name: 'Use location' })).toBeDisabled();
  view.rerender(<LocationMapPicker {...props} excludeIds={[drawer.id]} />);
  expect(screen.getByRole('button', { name: 'Use location' })).toBeDisabled();
  view.rerender(<LocationMapPicker {...props} disabled />);
  expect(screen.getByRole('button', { name: 'Use location' })).toBeDisabled();
  view.rerender(<LocationMapPicker {...props} />);
  await user.click(screen.getByRole('button', { name: 'Use location' }));
  expect(use).toHaveBeenCalledWith(drawer.code);
});
it('cancel leaves the form untouched and revocation synchronously masks the portal', async () => {
  const user = userEvent.setup(),
    use = vi.fn(),
    close = vi.fn();
  const ui = (
    <LocationMapPicker
      locations={[root, drawer]}
      initialValue={drawer.id}
      disabled={false}
      onUse={use}
      onClose={close}
    />
  );
  const view = render(ui);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
  expect(use).not.toHaveBeenCalled();
  view.unmount();
  render(ui);
  const dialog = screen.getByRole('dialog');
  act(() => {
    revokePrivatePresentation();
    expect(dialog).toHaveAttribute('hidden');
    expect(dialog).toHaveAttribute('inert');
  });
  expect(use).not.toHaveBeenCalled();
});
