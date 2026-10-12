import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  assignmentEpoch,
  batchKey,
  invalidateAssignmentCallbacks,
} from './assign-batch';
import { AssignmentScopeGuard } from './assignment-scope-guard';
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
      decodeFromStream = mocks.decode;
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
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));
import { ScanPanel } from './scan-panel';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const found = {
  status: 'found',
  matches: [{ path: '/locations/ITC', state: 'active', label: 'IT Closet' }],
};
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
    },
  });
  mocks.decode.mockResolvedValue({ stop: mocks.stop });
  mocks.resolve.mockResolvedValue({ status: 'unknown', matches: [] });
  mocks.resolveItemCode.mockResolvedValue({ status: 'unknown', matches: [] });
});
it.each(['manual', 'camera'])(
  'a %s serial collision shows context and lifecycle without silently opening either asset',
  async (mode) => {
    mocks.resolve.mockResolvedValue({
      status: 'ambiguous',
      matches: [
        {
          kind: 'asset',
          path: '/inventory/assets/70000000-0000-4000-8000-000000000001',
          label: 'Laptop (Tag-1)',
          name: 'Laptop',
          identifier: 'Tag-1',
          serialNumber: 'Serial-Mixed',
          state: 'active',
          context: 'Manufacturer: Dell · IT Closet / Red Container',
        },
        {
          kind: 'asset',
          path: '/inventory/assets/70000000-0000-4000-8000-000000000002',
          label: 'Spare laptop (Tag-2)',
          name: 'Spare laptop',
          identifier: 'Tag-2',
          state: 'retired',
          context:
            'Manufacturer: Lenovo · Last recorded storage: Black Container',
        },
      ],
    });
    render(<ScanPanel />);
    if (mode === 'manual') {
      fireEvent.change(screen.getByLabelText(/Paste a label URL/), {
        target: { value: 'Serial-Mixed' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
      await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
      mocks.decode.mock.calls[0][2]({ getText: () => 'Serial-Mixed' });
    }
    expect(
      await screen.findByRole('link', { name: 'Laptop (Tag-1)' }),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: 'Laptop (Tag-1)' }),
    ).toHaveAttribute(
      'href',
      '/inventory/assets/70000000-0000-4000-8000-000000000001',
    );
    expect(
      screen.getByRole('link', { name: 'Spare laptop (Tag-2)' }),
    ).toHaveAttribute(
      'href',
      '/inventory/assets/70000000-0000-4000-8000-000000000002',
    );
    expect(
      screen.getByRole('list', { name: 'Matching records' }),
    ).toHaveTextContent('Dell · IT Closet / Red Container');
    expect(
      screen.getByRole('list', { name: 'Matching records' }),
    ).toHaveTextContent('Retired');
    expect(screen.getByRole('link', { name: 'Laptop (Tag-1)' })).toHaveFocus();
    expect(
      screen.getByRole('link', { name: 'Laptop (Tag-1)' }),
    ).toHaveAccessibleDescription(
      'Serial: Serial-Mixed · Manufacturer: Dell · IT Closet / Red Container',
    );
    expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('Serial-Mixed');
    expect(mocks.push).not.toHaveBeenCalled();
  },
);
it('a saturated result never claims a unique match and offers ordinary inventory search', async () => {
  mocks.resolve.mockResolvedValue({
    status: 'found',
    truncated: true,
    matches: [
      {
        kind: 'asset',
        path: '/inventory/assets/70000000-0000-4000-8000-000000000001',
        label: 'Laptop',
        state: 'active',
      },
    ],
  });
  render(<ScanPanel />);
  fireEvent.change(screen.getByLabelText(/Paste a label URL/), {
    target: { value: 'Serial' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(
    await screen.findByText(
      /Additional matches exist.*up to 20 records.*asset tag or record QR/,
    ),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Search inventory' }),
  ).toHaveAttribute('href', '/inventory');
  expect(screen.getByRole('link', { name: 'Laptop' })).toHaveFocus();
  expect(mocks.push).not.toHaveBeenCalled();
});
it('reports changed scope when an earlier sibling guard invalidates during mount before Scan subscribes', () => {
  const actorId = '00000000-0000-4000-8000-000000000001';
  sessionStorage.setItem(
    'inventory-assign-scope-v1',
    batchKey({
      actor: actorId,
      origin: window.location.origin,
      backend: 'https://previous.supabase.co',
    }),
  );
  const before = assignmentEpoch();
  render(
    <>
      <AssignmentScopeGuard
        actorId={actorId}
        backend="https://current.supabase.co"
      />
      <ScanPanel />
    </>,
  );
  expect(assignmentEpoch()).toBeGreaterThan(before);
  expect(screen.getByRole('status')).toHaveTextContent(
    'Your account changed. Reload Scan',
  );
  expect(screen.getByLabelText(/Paste a label URL/)).toBeDisabled();
  const open = screen.getByRole('button', { name: 'Open' });
  const camera = screen.getByRole('button', { name: 'Start camera' });
  expect(open).toBeDisabled();
  expect(camera).toBeDisabled();
  fireEvent.click(open);
  fireEvent.click(camera);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.resolveItemCode).not.toHaveBeenCalled();
  expect(mocks.decode).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
});
afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: undefined,
  });
});
it.each(['unknown', 'rejected'])(
  'restores manual input after a deferred %s lookup',
  async (outcome) => {
    const pending = deferred<unknown>();
    mocks.resolve.mockReturnValue(pending.promise);
    render(<ScanPanel />);
    const input = screen.getByLabelText(/Paste a label URL/);
    fireEvent.change(input, { target: { value: 'UNKNOWN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(
      screen.getByRole('region', { name: 'Equipment inspection' }),
    ).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Inspecting equipment…',
    );
    expect(
      screen.getByRole('button', { name: 'Cancel inspection' }),
    ).toHaveFocus();
    await act(async () => {
      if (outcome === 'unknown')
        pending.resolve({ status: 'unknown', matches: [] });
      else pending.reject(new Error('offline'));
    });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('UNKNOWN');
    expect(
      screen.getByRole('region', { name: 'Equipment inspection' }),
    ).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByRole('button', { name: 'Open' })).toBeEnabled();
    expect(mocks.push).not.toHaveBeenCalled();
  },
);
it('focuses and announces the ambiguous chooser after inspection', async () => {
  const pending = deferred<unknown>();
  mocks.resolve.mockReturnValue(pending.promise);
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await act(async () =>
    pending.resolve({
      status: 'ambiguous',
      matches: [
        found.matches[0],
        { path: '/locations/OTHER', state: 'active', label: 'Other' },
      ],
    }),
  );
  expect(screen.getByRole('link', { name: 'IT Closet' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Choose the intended record',
  );
  expect(mocks.push).not.toHaveBeenCalled();
});
it.each(['cancel', 'text', 'mode', 'account'])(
  'invalidates a pending lookup on %s without late navigation or context changes',
  async (action) => {
    const pending = deferred<unknown>();
    mocks.resolve.mockReturnValue(pending.promise);
    render(<ScanPanel />);
    const input = screen.getByLabelText(/Paste a label URL/);
    fireEvent.change(input, { target: { value: 'LOC:ITC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    if (action === 'cancel') {
      fireEvent.click(
        screen.getByRole('button', { name: 'Cancel inspection' }),
      );
      expect(input).toHaveFocus();
    } else if (action === 'text')
      fireEvent.change(input, { target: { value: 'NEW' } });
    else if (action === 'mode')
      fireEvent.click(screen.getByLabelText('Quantity item code (SKU)'));
    else act(() => invalidateAssignmentCallbacks());
    await act(async () => pending.resolve(found));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(input).toHaveValue(
      action === 'account' ? '' : action === 'text' ? 'NEW' : 'LOC:ITC',
    );
    expect(
      screen.queryByRole('list', { name: 'Matching records' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Equipment inspection' }),
    ).toHaveAttribute('aria-busy', 'false');
    if (action === 'account') {
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
      expect(mocks.resolve).toHaveBeenCalledTimes(1);
      expect(mocks.decode).not.toHaveBeenCalled();
    }
  },
);
it('cancels a deferred camera inspection, releases the camera and ignores duplicate/late frames', async () => {
  const pending = deferred<unknown>();
  mocks.resolve.mockReturnValue(pending.promise);
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  const frame = mocks.decode.mock.calls[0][2];
  act(() => {
    frame({ getText: () => 'LOC:ITC' });
    frame({ getText: () => 'LOC:ITC' });
  });
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Cancel inspection' }),
  ).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel inspection' }));
  act(() => frame({ getText: () => 'LOC:ITC' }));
  await act(async () => pending.resolve(found));
  expect(screen.getByLabelText(/Paste a label URL/)).toHaveFocus();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
});
it('announces a resolved active record before normal navigation', async () => {
  const pending = deferred<unknown>();
  mocks.resolve.mockReturnValue(pending.promise);
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await act(async () => pending.resolve(found));
  expect(screen.getByRole('status')).toHaveTextContent('Opening IT Closet');
  expect(mocks.push).toHaveBeenCalledWith('/locations/ITC');
});
it('releases pending decoder setup after an account change and ignores its late frame', async () => {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  const setup = deferred<{ stop: () => void }>();
  mocks.decode.mockReturnValue(setup.promise);
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  act(() => invalidateAssignmentCallbacks());
  expect(track.stop).toHaveBeenCalled();
  act(() => mocks.decode.mock.calls[0][2]({ getText: () => 'LOC:ITC' }));
  await act(async () => setup.resolve({ stop: mocks.stop }));
  expect(mocks.stop).toHaveBeenCalledTimes(1);
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Your account changed');
  expect(
    screen.getByRole('button', { name: 'Start camera' }),
  ).toBeInTheDocument();
});
it('stops active Scan capture on invalidation without allowing old frames to look up records', async () => {
  const track = { stop: vi.fn() };
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue({
    getTracks: () => [track],
  } as unknown as MediaStream);
  render(<ScanPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await screen.findByRole('button', { name: 'Stop camera' });
  act(() => invalidateAssignmentCallbacks());
  expect(track.stop).toHaveBeenCalled();
  expect(mocks.stop).toHaveBeenCalledOnce();
  act(() => mocks.decode.mock.calls[0][2]({ getText: () => 'LOC:ITC' }));
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.push).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Start camera' })).toBeDisabled();
});
it.each(['invalidate', 'unmount'] as const)(
  'releases late Scan permission after %s before decoder startup',
  async (action) => {
    const permission = deferred<MediaStream>();
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
      permission.promise,
    );
    const track = { stop: vi.fn() };
    const view = render(<ScanPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
    await waitFor(() =>
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce(),
    );
    if (action === 'unmount') view.unmount();
    else act(() => invalidateAssignmentCallbacks());
    await act(async () =>
      permission.resolve({
        getTracks: () => [track],
      } as unknown as MediaStream),
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(mocks.decode).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  },
);
it('does not let an old failure steal focus or clear a newer pending inspection', async () => {
  const old = deferred<unknown>();
  const current = deferred<unknown>();
  mocks.resolve
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  render(<ScanPanel />);
  const input = screen.getByLabelText(/Paste a label URL/);
  fireEvent.change(input, { target: { value: 'OLD' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  fireEvent.change(input, { target: { value: 'NEW' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  await act(async () => old.reject(new Error('old response failed')));
  expect(
    screen.getByRole('button', { name: 'Cancel inspection' }),
  ).toHaveFocus();
  expect(
    screen.getByRole('region', { name: 'Equipment inspection' }),
  ).toHaveAttribute('aria-busy', 'true');
  expect(input).toHaveValue('NEW');
  await act(async () => current.resolve({ status: 'unknown', matches: [] }));
  expect(input).toHaveFocus();
});
it('starts only on action, requests rear camera, and releases on Stop', async () => {
  render(<ScanPanel />);
  expect(mocks.decode).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Start camera' }));
  await waitFor(() => expect(mocks.decode).toHaveBeenCalled());
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
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
  fireEvent.click(screen.getByLabelText('Quantity item code (SKU)'));
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
  fireEvent.click(screen.getByLabelText('Quantity item code (SKU)'));
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
