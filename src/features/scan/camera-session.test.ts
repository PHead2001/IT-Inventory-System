import { beforeEach, expect, it, vi } from 'vitest';
import { createCameraSession } from './camera-session';
type Decoder = Parameters<typeof createCameraSession>[0]['decodeFromStream'];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function capture() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}
beforeEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
});
it('owns active controls and tracks and fences decoded callbacks after Stop', async () => {
  const { stream, track } = capture();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  const stop = vi.fn();
  const preview = document.createElement('video');
  const decode = vi.fn<Decoder>(async () => {
    preview.srcObject = stream;
    return { stop };
  });
  const detected = vi.fn();
  const session = createCameraSession(
    { decodeFromStream: decode },
    preview,
    detected,
  );
  expect(await session.start()).toBe(true);
  session.stop();
  expect(stop).toHaveBeenCalledOnce();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(preview.srcObject).toBeNull();
  const callback = decode.mock.calls[0][2];
  callback(undefined, undefined, { stop });
  expect(detected).not.toHaveBeenCalled();
});
it('stops permission results that arrive after cancellation without attaching or decoding', async () => {
  const permission = deferred<MediaStream>();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(
    permission.promise,
  );
  const { stream, track } = capture();
  const decode = vi.fn<Decoder>();
  const preview = document.createElement('video');
  preview.srcObject = null;
  const session = createCameraSession(
    { decodeFromStream: decode },
    preview,
    vi.fn(),
  );
  const pending = session.start();
  session.stop();
  permission.resolve(stream);
  expect(await pending).toBe(false);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(decode).not.toHaveBeenCalled();
  expect(preview.srcObject).toBeNull();
});
it('releases tracks while decoder setup is pending, then stops its late controls', async () => {
  const { stream, track } = capture();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  const startup = deferred<{ stop: () => void }>();
  const preview = document.createElement('video');
  const decode = vi.fn<Decoder>(() => {
    preview.srcObject = stream;
    return startup.promise;
  });
  const detected = vi.fn();
  const session = createCameraSession(
    { decodeFromStream: decode },
    preview,
    detected,
  );
  const pending = session.start();
  await Promise.resolve();
  session.stop();
  expect(track.stop).toHaveBeenCalledOnce();
  expect(preview.srcObject).toBeNull();
  const stop = vi.fn();
  startup.resolve({ stop });
  expect(await pending).toBe(false);
  expect(stop).toHaveBeenCalledOnce();
  decode.mock.calls[0][2](undefined, undefined, { stop });
  expect(detected).not.toHaveBeenCalled();
});
it('releases an acquired stream when decoder startup fails', async () => {
  const { stream, track } = capture();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockResolvedValue(stream);
  const failure = new Error('Decoder startup failed');
  const preview = document.createElement('video');
  const decode = vi.fn<Decoder>(async () => {
    preview.srcObject = stream;
    throw failure;
  });
  const session = createCameraSession(
    { decodeFromStream: decode },
    preview,
    vi.fn(),
  );
  await expect(session.start()).rejects.toBe(failure);
  expect(track.stop).toHaveBeenCalledOnce();
  expect(preview.srcObject).toBeNull();
});
