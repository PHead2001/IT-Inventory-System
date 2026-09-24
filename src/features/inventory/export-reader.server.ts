import 'server-only';

export const maxSnapshotBytes = 2 * 1024 * 1024;
export class SnapshotTooLargeError extends Error {
  constructor() {
    super('snapshot_too_large');
  }
}
export async function readBoundedJson(
  response: Response,
  maxBytes = maxSnapshotBytes,
  checkDeadline: () => void = () => {},
  onStage?: (
    stage: 'raw_chunk' | 'raw_read' | 'json_parsed',
    bytes: number,
  ) => void,
): Promise<unknown> {
  checkDeadline();
  if (!response.body) throw new Error('empty_export_response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      checkDeadline();
      const { done, value } = await reader.read();
      checkDeadline();
      if (done) break;
      bytes += value.byteLength;
      onStage?.('raw_chunk', bytes);
      if (bytes > maxBytes) {
        onStage?.('raw_read', bytes);
        await reader.cancel();
        throw new SnapshotTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const complete = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    complete.set(chunk, offset);
    offset += chunk.byteLength;
    checkDeadline();
  }
  checkDeadline();
  onStage?.('raw_read', bytes);
  const parsed = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(complete),
  );
  checkDeadline();
  onStage?.('json_parsed', bytes);
  return parsed;
}

export async function requestExportSnapshot(input: {
  url: string;
  key: string;
  accessToken: string;
  payload: Record<string, unknown>;
  signal: AbortSignal;
  checkDeadline: () => void;
  onStage?: (
    stage: 'raw_chunk' | 'raw_read' | 'json_parsed',
    bytes: number,
  ) => void;
}): Promise<{ data: unknown; code?: string }> {
  input.checkDeadline();
  const response = await fetch(
    new URL('/rest/v1/rpc/inventory_export_snapshot', input.url),
    {
      method: 'POST',
      headers: {
        apikey: input.key,
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(input.payload),
      signal: input.signal,
      cache: 'no-store',
    },
  );
  input.checkDeadline();
  const data = await readBoundedJson(
    response,
    response.ok ? maxSnapshotBytes : 65536,
    input.checkDeadline,
    input.onStage,
  );
  input.checkDeadline();
  if (!response.ok) {
    const code =
      data &&
      typeof data === 'object' &&
      'code' in data &&
      typeof data.code === 'string'
        ? data.code
        : undefined;
    return { data: null, code };
  }
  return { data };
}
