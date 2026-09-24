import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  stop: vi.fn(),
  resolve: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    decodeFromConstraints = mocks.decode;
  },
}));
vi.mock('./resolve.server', () => ({ resolveScan: mocks.resolve }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
import { ScanPanel } from './scan-panel';
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  mocks.decode.mockResolvedValue({ stop: mocks.stop });
  mocks.resolve.mockResolvedValue({ status: 'unknown', matches: [] });
});
afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: undefined,
  });
});
it('starts only on action, requests rear camera, and releases on Stop', async () => {
  render(<ScanPanel />);
  expect(mocks.decode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  expect(mocks.decode.mock.calls[0][0]).toMatchObject({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});
it('suppresses duplicate detections and stops before opening a record', async () => {
  mocks.resolve.mockResolvedValue({
    status: 'found',
    matches: [{ path: '/locations/ITC', state: 'active' }],
  });
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  const callback = mocks.decode.mock.calls[0][2];
  callback({ getText: () => 'LOC:ITC' });
  callback({ getText: () => 'LOC:ITC' });
  await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.stop).toHaveBeenCalled();
});
it('reports denied camera permission and leaves manual lookup usable', async () => {
  mocks.decode.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  expect(
    await screen.findByText(/Camera permission was denied/),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Paste a label URL/), {
    target: { value: 'LOC:ITC' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledWith('LOC:ITC'));
});
it('releases camera when the scan page unmounts', async () => {
  const page = render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  page.unmount();
  expect(mocks.stop).toHaveBeenCalledTimes(1);
});
it('ignores late frames after Stop while camera setup is pending', async () => {
  let finish!: (value: { stop: () => void }) => void;
  mocks.decode.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  const callback = mocks.decode.mock.calls[0][2];
  fireEvent.click(screen.getByRole('button', { name: 'Stop camera' }));
  callback({ getText: () => 'LOC:ITC' });
  finish({ stop: mocks.stop });
  await waitFor(() => expect(mocks.stop).toHaveBeenCalledTimes(1));
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
it('does not navigate after an in-flight lookup completes on an unmounted page', async () => {
  let finish!: (value: unknown) => void;
  mocks.resolve.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const page = render(<ScanPanel />);
  fireEvent.change(screen.getByLabelText(/Paste a label URL/), {
    target: { value: 'LOC:ITC' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
  page.unmount();
  finish({
    status: 'found',
    matches: [{ path: '/locations/ITC', state: 'active' }],
  });
  await Promise.resolve();
  expect(mocks.push).not.toHaveBeenCalled();
});
it('clears a cancelled lookup when camera retry fails, allowing manual input again', async () => {
  let finish!: (value: unknown) => void;
  mocks.resolve
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue({ status: 'unknown', matches: [] });
  mocks.decode.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
  render(<ScanPanel />);
  const input = screen.getByLabelText(/Paste a label URL/);
  fireEvent.change(input, { target: { value: 'LOC:ITC' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  expect(
    await screen.findByText(/Camera permission was denied/),
  ).toBeInTheDocument();
  finish({
    status: 'found',
    matches: [{ path: '/locations/ITC', state: 'active' }],
  });
  await Promise.resolve();
  expect(mocks.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() => expect(mocks.resolve).toHaveBeenCalledTimes(2));
});
