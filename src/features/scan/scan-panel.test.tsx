import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  stop: vi.fn(),
  resolve: vi.fn(),
  resolveItemCode: vi.fn(),
  push: vi.fn(),
}));
vi.mock('@zxing/browser', async () => {
  const { NotFoundException } = await import('@zxing/library');
  return {
    BrowserMultiFormatReader: class {
      decodeFromConstraints = mocks.decode;
      decodeFromCanvas() {
        throw new NotFoundException();
      }
    },
  };
});
vi.mock('./resolve.server', () => ({
  resolveScan: mocks.resolve,
  resolveItemCode: mocks.resolveItemCode,
}));
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
  mocks.resolveItemCode.mockResolvedValue({ status: 'unknown', matches: [] });
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
it('passes a captured camera frame through the production fallback and resolver', async () => {
  const png = PNG.sync.read(
    readFileSync('tests/fixtures/qr/pr13-asset-label-zxing-miss.png'),
  );
  const canvas = {
    width: png.width,
    height: png.height,
    getContext: () => ({
      getImageData: () => ({
        data: new Uint8ClampedArray(png.data),
        width: png.width,
        height: png.height,
      }),
    }),
  } as unknown as HTMLCanvasElement;
  mocks.decode.mockImplementationOnce(async function (
    this: {
      decodeFromCanvas: (frame: HTMLCanvasElement) => { getText(): string };
    },
    _constraints: unknown,
    _video: unknown,
    callback: (result: { getText(): string }) => void,
  ) {
    callback(this.decodeFromCanvas(canvas));
    return { stop: mocks.stop };
  });
  mocks.resolve.mockResolvedValue({
    status: 'found',
    matches: [
      {
        path: '/inventory/assets/9fee7834-40a4-4983-94a1-6eee3ecad3ee',
        state: 'active',
      },
    ],
  });
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() =>
    expect(mocks.resolve).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/inventory/assets/9fee7834-40a4-4983-94a1-6eee3ecad3ee',
    ),
  );
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      '/inventory/assets/9fee7834-40a4-4983-94a1-6eee3ecad3ee',
    ),
  );
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
it('keeps the camera action honest after a manual lookup misses', async () => {
  render(<ScanPanel />);
  fireEvent.change(screen.getByLabelText(/Paste a label URL/), {
    target: { value: 'UNKNOWN' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(await screen.findByText(/No matching location/)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Start camera' }),
  ).toBeInTheDocument();
});
it('routes explicit Item code input through exact quantity lookup without interpreting URL-like text', async () => {
  mocks.resolveItemCode.mockResolvedValue({
    status: 'found',
    matches: [
      {
        kind: 'quantity',
        path: '/inventory/quantity/7b84a7cf-197b-45b1-8016-87482d124cb4',
        state: 'active',
        label: 'Cable (/SKU)',
      },
    ],
  });
  render(<ScanPanel />);
  fireEvent.click(screen.getByLabelText('Quantity Item code (SKU)'));
  const input = screen.getByLabelText('Enter the exact Item code (SKU)');
  fireEvent.change(input, { target: { value: '/SKU' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await waitFor(() =>
    expect(mocks.resolveItemCode).toHaveBeenCalledWith('/SKU'),
  );
  await waitFor(() =>
    expect(mocks.push).toHaveBeenCalledWith(
      '/inventory/quantity/7b84a7cf-197b-45b1-8016-87482d124cb4',
    ),
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('keeps camera payloads in label mode even when manual Item code mode is selected', async () => {
  render(<ScanPanel />);
  fireEvent.click(screen.getByLabelText('Quantity Item code (SKU)'));
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  mocks.decode.mock.calls[0][2]({
    getText: () => 'https://evil.test/inventory/quantity/abc',
  });
  await waitFor(() =>
    expect(mocks.resolve).toHaveBeenCalledWith(
      'https://evil.test/inventory/quantity/abc',
    ),
  );
  expect(mocks.resolveItemCode).not.toHaveBeenCalled();
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
