import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssignCamera } from './assign-camera';
import { invalidateAssignmentCallbacks } from './assign-batch';
import { QueueLogoutForm } from '@/features/labels/queue-logout-form';
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  stop: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/auth/actions', () => ({
  signOutSession: mocks.signOut,
  acknowledgeLogoutPrivacyGeneration: async () => ({ status: 'match' }),
  readLogoutPrivacyGeneration: async () => ({ status: 'absent' }),
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/test',
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('./inventory-code-reader', () => ({
  InventoryCodeReader: class {
    decodeFromStream = mocks.decode;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
    },
  });
  mocks.decode.mockResolvedValue({ stop: mocks.stop });
});
afterEach(() => vi.unstubAllGlobals());
it('stops an active camera when the session is invalidated without a scope prop change', async () => {
  const track = { stop: vi.fn() };
  vi.stubGlobal(
    'MediaStream',
    class {
      getTracks() {
        return [track];
      }
    },
  );
  const stream = new MediaStream();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  mocks.decode.mockImplementation(async (_constraints, video) => {
    video.srcObject = stream;
    return { stop: mocks.stop };
  });
  const detected = vi.fn();
  render(<AssignCamera onDetection={detected} scope="actorA:preview" />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByRole('button', { name: 'Stop camera' });
  act(() => invalidateAssignmentCallbacks());
  expect(mocks.stop).toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalled();
  act(() => mocks.decode.mock.calls[0][2]({ getText: () => 'stale' }));
  expect(detected).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start camera' })).toBeDisabled();
});
it('starts only on user action, forwards decoded or missing frames and releases on stop/unmount', async () => {
  const detected = vi.fn();
  const view = render(
    <AssignCamera onDetection={detected} scope="actorA:preview" />,
  );
  expect(mocks.decode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  mocks.decode.mock.calls[0][2]({ getText: () => '/inventory/quantity/test' });
  mocks.decode.mock.calls[0][2](undefined);
  expect(detected.mock.calls).toEqual([['/inventory/quantity/test'], [null]]);
  view.unmount();
  expect(mocks.stop).toHaveBeenCalledOnce();
});
it('releases a late-opening camera when the actor/environment scope changes', async () => {
  let finish!: (value: { stop: () => void }) => void;
  mocks.decode.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const detected = vi.fn();
  const view = render(<AssignCamera onDetection={detected} scope="actorA" />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  view.rerender(<AssignCamera onDetection={detected} scope="actorB" />);
  mocks.decode.mock.calls[0][2]({ getText: () => 'stale' });
  finish({ stop: mocks.stop });
  await waitFor(() => expect(mocks.stop).toHaveBeenCalled());
  expect(detected).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start camera' })).toBeEnabled();
});
it('stops capture on an actor switch and requires a deliberate Start in the new scope', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  const detected = vi.fn();
  const view = render(<AssignCamera onDetection={detected} scope="actorA" />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByRole('button', { name: 'Stop camera' });
  view.rerender(<AssignCamera onDetection={detected} scope="actorB" />);
  expect(track.stop).toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Start camera' })).toBeEnabled();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  act(() => mocks.decode.mock.calls[0][2]({ getText: () => 'stale actor' }));
  expect(detected).not.toHaveBeenCalled();
});
it('distinguishes denied permission from no decoded label and retains the retry action', async () => {
  mocks.decode.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  render(<AssignCamera onDetection={vi.fn()} scope="actorA" />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByText(/Camera permission was denied/);
  expect(screen.getByRole('button', { name: 'Retry camera' })).toBeEnabled();
});
it('releases capture when sign-out fails and the route and scope props remain mounted', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  mocks.decode.mockImplementation(async (_stream, preview) => {
    preview.srcObject = stream;
    return { stop: mocks.stop };
  });
  mocks.signOut.mockResolvedValue({ ok: false, message: 'Sign-out failed.' });
  const detected = vi.fn();
  render(
    <>
      <AssignCamera onDetection={detected} scope="actorA:preview" />
      <QueueLogoutForm />
    </>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByRole('button', { name: 'Stop camera' });
  fireEvent.submit(
    screen.getByRole('button', { name: 'Sign out' }).closest('form')!,
  );
  await screen.findByText('Sign-out failed.');
  expect(mocks.stop).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalled();
  act(() =>
    mocks.decode.mock.calls[0][2]({ getText: () => 'private stale label' }),
  );
  expect(detected).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start camera' })).toBeDisabled();
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
});
it.each(['invalidate', 'unmount'] as const)(
  'releases a late permission result after %s without starting its decoder',
  async (action) => {
    let finish!: (stream: MediaStream) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const detected = vi.fn();
    const view = render(<AssignCamera onDetection={detected} scope="actorA" />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce(),
    );
    if (action === 'unmount') view.unmount();
    else act(() => invalidateAssignmentCallbacks());
    await act(async () => finish(stream));
    expect(track.stop).toHaveBeenCalledOnce();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(detected).not.toHaveBeenCalled();
    if (action === 'invalidate') {
      view.rerender(<AssignCamera onDetection={detected} scope="actorA" />);
      expect(
        screen.getByRole('button', { name: 'Start camera' }),
      ).toBeDisabled();
    }
  },
);
it('keeps a new deliberate camera start isolated from late old decoder cleanup', async () => {
  const oldTrack = { stop: vi.fn() };
  const newTrack = { stop: vi.fn() };
  const oldStream = { getTracks: () => [oldTrack] } as unknown as MediaStream;
  const newStream = { getTracks: () => [newTrack] } as unknown as MediaStream;
  vi.mocked(navigator.mediaDevices.getUserMedia)
    .mockResolvedValueOnce(oldStream)
    .mockResolvedValueOnce(newStream);
  let finish!: (controls: { stop: () => void }) => void;
  mocks.decode
    .mockImplementationOnce((_stream, preview) => {
      preview.srcObject = oldStream;
      return new Promise((resolve) => {
        finish = resolve;
      });
    })
    .mockImplementationOnce(async (_stream, preview) => {
      preview.srcObject = newStream;
      return { stop: mocks.stop };
    });
  const detected = vi.fn();
  render(<AssignCamera onDetection={detected} scope="actorA" />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
  const oldPreview = mocks.decode.mock.calls[0][1];
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  expect(oldTrack.stop).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledTimes(2));
  const newPreview = mocks.decode.mock.calls[1][1];
  expect(newPreview).not.toBe(oldPreview);
  const lateStop = vi.fn(() => {
    oldPreview.srcObject = null;
  });
  await act(async () => finish({ stop: lateStop }));
  expect(lateStop).toHaveBeenCalledOnce();
  expect(newPreview.srcObject).toBe(newStream);
  expect(newTrack.stop).not.toHaveBeenCalled();
  act(() => mocks.decode.mock.calls[0][2]({ getText: () => 'old' }));
  expect(detected).not.toHaveBeenCalled();
});
