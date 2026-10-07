import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssignCamera } from './assign-camera';
const mocks = vi.hoisted(() => ({ decode: vi.fn(), stop: vi.fn() }));
vi.mock('./inventory-code-reader', () => ({
  InventoryCodeReader: class {
    decodeFromConstraints = mocks.decode;
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  mocks.decode.mockResolvedValue({ stop: mocks.stop });
});
it('starts only on user action, forwards decoded or missing frames and releases on stop/unmount', async () => {
  const detected = vi.fn();
  const view = render(
    <AssignCamera onDetection={detected} scope="actorA:preview" />,
  );
  expect(mocks.decode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalledOnce());
  expect(mocks.decode.mock.calls[0][0]).toMatchObject({
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
it('distinguishes denied permission from no decoded label and retains the retry action', async () => {
  mocks.decode.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  render(<AssignCamera onDetection={vi.fn()} scope="actorA" />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByText(/Camera permission was denied/);
  expect(screen.getByRole('button', { name: 'Retry camera' })).toBeEnabled();
});
