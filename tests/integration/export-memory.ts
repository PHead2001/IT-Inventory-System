import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  readBoundedJson,
  maxSnapshotBytes,
  SnapshotTooLargeError,
} from '../../src/features/inventory/export-reader.server';
import {
  exportCsv,
  ExportTooLargeError,
} from '../../src/features/inventory/export';

// Run in its own process: node --conditions=react-server --expose-gc --import tsx tests/integration/export-memory.ts
// The source fixture is retained before baseline sampling. Its bytes are added
// to the reported incremental budget to account for incoming response storage.
const MiB = 1024 * 1024;
const id = '11111111-1111-4111-8111-111111111111';
const field = '22222222-2222-4222-8222-222222222222';
function row(index: number, value: string) {
  return {
    entity_id: id,
    kind: 'quantity',
    name: `Measured export ${index}`,
    category_name: 'Measured',
    manufacturer: null,
    model: null,
    asset_tag: null,
    serial_number: null,
    status: 'active',
    quantity: 0,
    location_name: null,
    location_code: null,
    breadcrumb: null,
    custom_fields: {
      [field]: {
        category_id: id,
        validated_revision_id: id,
        label: `Quoted 😀 field ${index}`,
        value,
        option_paths: [['=formula', 'quoted " child', 'slash \\ child']],
      },
    },
  };
}
function streamedResponse(raw: Uint8Array) {
  let offset = 0;
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= raw.byteLength) return controller.close();
        const end = Math.min(offset + 32768, raw.byteLength);
        controller.enqueue(raw.slice(offset, end));
        offset = end;
      },
    }),
  );
}
function sampler() {
  const baseline = process.memoryUsage();
  const baselineCombined = baseline.heapUsed + baseline.external;
  let peakCombined = baselineCombined;
  let peakRss = baseline.rss;
  let samples = 0;
  const check = () => {
    const current = process.memoryUsage();
    peakCombined = Math.max(peakCombined, current.heapUsed + current.external);
    peakRss = Math.max(peakRss, current.rss);
    samples++;
  };
  return {
    check,
    result(inputBytes: number) {
      check();
      return {
        inputBytes,
        sampledIncrementalBytes:
          Math.max(0, peakCombined - baselineCombined) + inputBytes,
        sampledRssIncreaseBytes: Math.max(0, peakRss - baseline.rss),
        samples,
      };
    },
  };
}
async function measure(label: string, snapshot: unknown) {
  const raw = new TextEncoder().encode(JSON.stringify(snapshot));
  assert.ok(
    raw.byteLength <= maxSnapshotBytes,
    `${label}: snapshot fits DB/reader envelope`,
  );
  global.gc?.();
  const memory = sampler();
  const started = performance.now();
  const parsed = await readBoundedJson(
    streamedResponse(raw),
    maxSnapshotBytes,
    memory.check,
  );
  memory.check();
  let csvBytes: number | null = null;
  try {
    const { csv } = exportCsv(
      'inventory',
      parsed,
      'Preview',
      true,
      memory.check,
    );
    csvBytes = new TextEncoder().encode(csv).byteLength;
    assert.ok(csvBytes <= 3 * MiB);
  } catch (error) {
    if (error instanceof ExportTooLargeError)
      throw new Error(`${label}: unexpected CSV limit`, { cause: error });
    throw error;
  }
  const elapsedMs = performance.now() - started;
  const result = memory.result(raw.byteLength);
  assert.ok(
    result.sampledIncrementalBytes <= 64 * MiB,
    `${label}: sampled allocation budget`,
  );
  assert.ok(elapsedMs < 10000, `${label}: local reader + parse + CSV deadline`);
  return { label, ...result, csvBytes, elapsedMs };
}

const envelope = (rows: ReturnType<typeof row>[]) => ({
  rows,
  total: String(rows.length),
  exported_at: '2026-09-24T15:18:37+00:00',
});
const nearLimit = await measure(
  'near-2MiB multibyte accepted',
  envelope(
    Array.from({ length: 8 }, (_, index) =>
      row(index, '😀"\\\n'.repeat(24000)),
    ),
  ),
);
const overCsvSnapshot = envelope(
  Array.from({ length: 6 }, (_, index) => row(index, '"'.repeat(200000))),
);
global.gc?.();
const csvSampler = sampler();
const csvStarted = performance.now();
assert.throws(
  () =>
    exportCsv('inventory', overCsvSnapshot, 'Preview', true, csvSampler.check),
  ExportTooLargeError,
);
const csvLimit = {
  label: 'CSV quote expansion capped before response',
  ...csvSampler.result(0),
  elapsedMs: performance.now() - csvStarted,
};
assert.ok(
  csvLimit.sampledIncrementalBytes <= 64 * MiB,
  `CSV quote expansion sampled ${csvLimit.sampledIncrementalBytes} bytes; limit ${64 * MiB}`,
);
assert.ok(csvLimit.elapsedMs < 10000);
const overflowRaw = new Uint8Array(maxSnapshotBytes + 1);
const overResponse = streamedResponse(overflowRaw);
await assert.rejects(
  readBoundedJson(overResponse, maxSnapshotBytes),
  SnapshotTooLargeError,
);
const emptyEnvelope = '{"padding":""}';
const exactRaw = new TextEncoder().encode(
  '{"padding":"' + 'x'.repeat(maxSnapshotBytes - emptyEnvelope.length) + '"}',
);
assert.equal(exactRaw.byteLength, maxSnapshotBytes);
const exactParsed = await readBoundedJson(
  streamedResponse(exactRaw),
  maxSnapshotBytes,
);
assert.equal(
  (exactParsed as { padding: string }).padding.length,
  maxSnapshotBytes - emptyEnvelope.length,
);
console.log(
  JSON.stringify({
    nearLimit,
    csvLimit,
    exactRawAccepted: true,
    oversizeRawRejected: true,
  }),
);
