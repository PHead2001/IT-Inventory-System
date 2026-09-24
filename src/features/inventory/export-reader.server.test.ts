import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { readBoundedJson, SnapshotTooLargeError } from './export-reader.server';

function response(chunks: Uint8Array[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  }));
}
describe('bounded raw export response', () => {
  it('accepts exactly the configured UTF-8 byte limit before parsing', async () => {
    const encoded = new TextEncoder().encode('{"x":"😀"}');
    expect(await readBoundedJson(response([encoded.subarray(0, 5), encoded.subarray(5)]), encoded.length))
      .toEqual({ x: '😀' });
  });
  it('rejects a response one byte above the limit before JSON parsing', async () => {
    const encoded = new TextEncoder().encode('{"x":"😀"}');
    await expect(readBoundedJson(response([encoded]), encoded.length - 1))
      .rejects.toBeInstanceOf(SnapshotTooLargeError);
  });
});
