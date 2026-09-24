import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import {
  maxSnapshotBytes,
  readBoundedJson,
  SnapshotTooLargeError,
} from './export-reader.server';

function response(chunks: Uint8Array[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
  );
}
describe('bounded raw export response', () => {
  it('accepts exactly the configured UTF-8 byte limit before parsing', async () => {
    const encoded = new TextEncoder().encode('{"x":"😀"}');
    expect(
      await readBoundedJson(
        response([encoded.subarray(0, 5), encoded.subarray(5)]),
        encoded.length,
      ),
    ).toEqual({ x: '😀' });
  });
  it('rejects a response one byte above the limit before JSON parsing', async () => {
    const encoded = new TextEncoder().encode('{"x":"😀"}');
    await expect(
      readBoundedJson(response([encoded]), encoded.length - 1),
    ).rejects.toBeInstanceOf(SnapshotTooLargeError);
  });
  it('honors the production 2 MiB UTF-8 boundary before JSON parsing', async () => {
    const exact = new TextEncoder().encode(
      '{"x":"' + '😀'.repeat((maxSnapshotBytes - 8) / 4) + '"}',
    );
    expect(exact.byteLength).toBe(maxSnapshotBytes);
    const decoded = await readBoundedJson(response([exact]));
    expect((decoded as { x: string }).x.startsWith('😀')).toBe(true);
    const over = new Uint8Array(maxSnapshotBytes + 1);
    over.set(exact);
    over[maxSnapshotBytes] = 65;
    await expect(readBoundedJson(response([over]))).rejects.toBeInstanceOf(
      SnapshotTooLargeError,
    );
  });
  it('checks the deadline between raw chunks and cancels a late response before parsing', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"x":'));
        controller.enqueue(new TextEncoder().encode('1}'));
      },
      cancel,
    });
    let checks = 0;
    await expect(
      readBoundedJson(new Response(body), 100, () => {
        if (++checks === 4) throw new Error('deadline');
      }),
    ).rejects.toThrow('deadline');
    expect(cancel).toHaveBeenCalled();
  });
});
