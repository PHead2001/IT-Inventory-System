import { useEffect, useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { ProtectedPrivacyContent } from '@/components/auth/privacy-content';
import { usePrivacyReadiness } from '@/components/auth/privacy-readiness';
import { RoomCameraSnapshotProvider } from '../room/scene/camera-snapshot-provider';
import { revokePrivatePresentation } from '../scan/assign-batch';
import { LocationPicker } from './location-picker';
import LocationMapPicker from './location-map-picker';
import type { LocationRef } from '../inventory/contracts-ui';

const actions = vi.hoisted(() => ({
  readLogoutPrivacyGeneration: vi.fn(),
  acknowledgeLogoutPrivacyGeneration: vi.fn(),
  readProtectedPrivacyIdentity: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/inventory/quantity/example',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/auth/privacy-read-transport', () => actions);
vi.mock('@/lib/auth/logout-transport', () => actions);
vi.mock('next/dynamic', () => ({
  default:
    () => (props: import('react').ComponentProps<typeof LocationMapPicker>) => (
      <LocationMapPicker {...props} />
    ),
}));
vi.mock('../room/embedded-room', () => ({
  EmbeddedRoom: ({ onSelect }: { onSelect(code: string): void }) => {
    const [camera, setCamera] = useState('original camera');
    useEffect(() => {
      actions.mount();
      return actions.unmount;
    }, []);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setCamera('moved camera');
            onSelect('ITC-D02');
          }}
        >
          Stage drawer and camera
        </button>
        <output>{camera}</output>
      </>
    );
  },
}));
const binding = {
  actorId: 'actor-a',
  backend: 'https://isolated.supabase.co',
  role: 'staff',
  canManageConfiguration: false,
};
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
  ...root,
  id: 'one',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'Closet / Drawer 1',
  parentId: root.id,
  can_hold_inventory: true,
};
const other: LocationRef = {
  ...drawer,
  id: 'two',
  code: 'ITC-D02',
  name: 'Drawer 2',
  breadcrumb: 'Closet / Drawer 2',
};
function Readiness() {
  const privacy = usePrivacyReadiness();
  return (
    <output data-testid="privacy">
      {privacy.ready ? 'ready' : 'checking'}:
      {privacy.visible ? 'visible' : 'hidden'}
    </output>
  );
}
beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  actions.readLogoutPrivacyGeneration.mockResolvedValue({ status: 'absent' });
  actions.acknowledgeLogoutPrivacyGeneration.mockResolvedValue({
    status: 'match',
  });
  actions.readProtectedPrivacyIdentity.mockResolvedValue({
    status: 'match',
    generation: { status: 'absent' },
  });
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

it.each(['cancel', 'revocation'] as const)(
  'preserves the actual protected checking dialog and withholds selection/focus, then safely handles %s',
  async (ending) => {
    const change = vi.fn();
    render(
      <ProtectedPrivacyBoundary binding={binding}>
        <ProtectedPrivacyContent>
          <RoomCameraSnapshotProvider
            actorId={binding.actorId}
            backend={binding.backend}
          >
            <Readiness />
            <input aria-label="Reason" defaultValue="Keep this work" />
            <LocationPicker
              locations={[root, drawer, other]}
              mode="destination"
              label="Destination"
              value={drawer.id}
              onValueChange={change}
            />
          </RoomCameraSnapshotProvider>
        </ProtectedPrivacyContent>
      </ProtectedPrivacyBoundary>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('privacy')).toHaveTextContent('ready:visible'),
    );
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Pick on map' });
    await user.click(trigger);
    await user.click(
      screen.getByRole('button', { name: 'Stage drawer and camera' }),
    );
    const dialog = screen.getByRole('dialog') as HTMLDialogElement;
    const canvas = screen.getByText('moved camera');
    const show = vi.spyOn(dialog, 'showModal'),
      close = vi.spyOn(dialog, 'close');
    let finish!: (value: { status: 'absent' }) => void;
    actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(screen.getByTestId('privacy')).toHaveTextContent('checking:visible');
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog).toHaveAttribute('open');
    expect(dialog).not.toHaveAttribute('hidden');
    expect(dialog).not.toHaveAttribute('inert');
    expect(
      screen.getByText(other.breadcrumb, { selector: 'p[role="status"]' }),
    ).toBeVisible();
    expect(screen.getByText('moved camera')).toBe(canvas);
    const confirm = screen.getByRole('button', { name: 'Use location' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(change).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    await act(async () => finish({ status: 'absent' }));
    expect(confirm).toBeEnabled();
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(actions.mount).toHaveBeenCalledOnce();
    expect(actions.unmount).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
    // A second real check does not transfer focus back into the retained form.
    actions.readLogoutPrivacyGeneration.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await act(async () => window.dispatchEvent(new Event('focus')));
    const focus = vi.spyOn(trigger, 'focus');
    if (ending === 'cancel')
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
    else act(() => revokePrivatePresentation());
    expect(dialog).not.toHaveAttribute('open');
    expect(focus).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Reason')).toHaveValue('Keep this work');
    expect(change).not.toHaveBeenCalled();
    await act(async () => finish({ status: 'absent' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  },
);
