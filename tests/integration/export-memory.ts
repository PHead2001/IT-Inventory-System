import { historyExportCsv } from '../../src/features/inventory/history-export';
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

// U313 uses the same raw/CSV primitives, with independent event identities.
const historyRows = Array.from({ length: 8 }, (_, index) => ({
  row_type: 'event',
  event_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  entity_id: id,
  kind: 'quantity',
  event_type: 'metadata_updated',
  created_at: '2026-10-10T12:00:00.123456Z',
  actor_id: id,
  actor_name: '😀"\\\n'.repeat(24000),
  name_current: 'Measured history',
  name_before: null,
  name_after: null,
  item_code_current: null,
  item_code_before: null,
  item_code_after: null,
  asset_tag_current: null,
  asset_tag_before: null,
  asset_tag_after: null,
  serial_number_current: null,
  serial_number_before: null,
  serial_number_after: null,
  reason: null,
  reference: null,
  event_quantity: null,
  from_location_id: null,
  from_location_code: null,
  from_label: null,
  to_location_id: null,
  to_location_code: null,
  to_label: null,
  from_site_id: null,
  from_site_code: null,
  to_site_id: null,
  to_site_code: null,
  endpoint_label_provenance: 'current reference labels',
}));
const historyRaw = new TextEncoder().encode(
  JSON.stringify({
    rows: historyRows,
    event_count: 8,
    row_count: 8,
    exported_at: '2026-10-10T12:00:00.123456Z',
  }),
);
assert.ok(historyRaw.byteLength < maxSnapshotBytes);
global.gc?.();
const historyMemory = sampler();
const historyStarted = performance.now();
const historyParsed = await readBoundedJson(
  streamedResponse(historyRaw),
  maxSnapshotBytes,
  historyMemory.check,
);
const historyCsv = historyExportCsv(
  historyParsed,
  'Preview',
  'UTC',
  historyMemory.check,
);
const historyResult = historyMemory.result(historyRaw.byteLength);
assert.ok(
  historyResult.sampledIncrementalBytes <= 64 * MiB,
  'history reader/parse/CSV sampled 64MiB incremental budget',
);
assert.ok(
  performance.now() - historyStarted < 10000,
  'history local processing deadline',
);
assert.ok(Buffer.byteLength(historyCsv.csv, 'utf8') <= 3 * MiB);
console.log(
  JSON.stringify({
    historyExport: historyResult,
    csvBytes: Buffer.byteLength(historyCsv.csv, 'utf8'),
  }),
);

// Also measure realistic per-row work: hundreds of events, each followed by a
// complete debit/credit ledger pair, mixing physical and custody movements.
// Pad bounded reasons to approach the JSON cap without giant actor fields.
const mixedEventCount = 700;
const sourceLocation = '33333333-3333-4333-8333-333333333333';
const destinationLocation = '44444444-4444-4444-8444-444444444444';
const destinationSite = '55555555-5555-4555-8555-555555555555';
const mixedEvents = Array.from({ length: mixedEventCount }, (_, index) => {
  const custody = index % 2 === 1;
  return {
    ...historyRows[0],
    event_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    event_type: custody ? 'site_issued' : 'moved',
    actor_name: 'Recorded Person 😀',
    name_current: `Quoted "adapter" 😀 ${index}`,
    item_code_current: '=SAFE-CODE-' + index,
    reason: '=Review "quoted" 😀 reason\r\n',
    reference: 'REF-' + index,
    event_quantity: custody ? 3 : null,
    from_location_id: sourceLocation,
    from_location_code: 'ITC-RED',
    from_label: 'Recorded Red',
    to_location_id: custody ? null : destinationLocation,
    to_location_code: custody ? null : 'ITC-BLACK',
    to_label: custody ? 'Recorded Site' : 'Black Container',
    to_site_id: custody ? destinationSite : null,
    to_site_code: custody ? 'SITE-TEST' : null,
    endpoint_label_provenance: custody
      ? 'recorded assignment labels'
      : 'current reference labels',
  };
});
const mixedRows: Array<Record<string, unknown>> = [];
for (const event of mixedEvents) {
  const custody = event.event_type === 'site_issued';
  const ledger = {
    row_type: 'quantity_line',
    kind: 'quantity',
    event_id: event.event_id,
    entity_id: id,
    site_id: null,
    site_code: null,
    site_label: null,
    line_label_provenance: 'current reference labels',
  };
  mixedRows.push(
    event,
    {
      ...ledger,
      location_id: sourceLocation,
      location_code: 'ITC-RED',
      location_label: 'Red Container',
      before_quantity: 7,
      delta: -3,
      after_quantity: 4,
    },
    {
      ...ledger,
      location_id: custody ? null : destinationLocation,
      location_code: custody ? null : 'ITC-BLACK',
      location_label: custody ? null : 'Black Container',
      site_id: custody ? destinationSite : null,
      site_code: custody ? 'SITE-TEST' : null,
      site_label: custody ? 'Site 😀' : null,
      before_quantity: 0,
      delta: 3,
      after_quantity: 3,
    },
  );
}
const mixedSnapshot = {
  rows: mixedRows,
  event_count: mixedEventCount,
  row_count: mixedRows.length,
  exported_at: '2026-10-10T12:00:00.123456Z',
};
const mixedBaseBytes = Buffer.byteLength(JSON.stringify(mixedSnapshot), 'utf8');
const reasonPadding = Math.floor(
  (maxSnapshotBytes - 32768 - mixedBaseBytes) / mixedEventCount,
);
assert.ok(
  reasonPadding >= 0 && reasonPadding + mixedEvents[0].reason.length <= 2000,
);
for (const event of mixedEvents) event.reason += 'r'.repeat(reasonPadding);
const mixedRaw = new TextEncoder().encode(JSON.stringify(mixedSnapshot));
assert.ok(mixedRaw.byteLength >= maxSnapshotBytes * 0.95);
assert.ok(mixedRaw.byteLength <= maxSnapshotBytes);
global.gc?.();
const mixedMemory = sampler();
const mixedStarted = performance.now();
const mixedParsed = await readBoundedJson(
  streamedResponse(mixedRaw),
  maxSnapshotBytes,
  mixedMemory.check,
);
const mixedCsv = historyExportCsv(
  mixedParsed,
  'Preview',
  'America/Chicago',
  mixedMemory.check,
);
const mixedResult = mixedMemory.result(mixedRaw.byteLength);
assert.equal(mixedCsv.eventCount, mixedEventCount);
assert.equal(mixedCsv.rowCount, mixedEventCount * 3);
assert.ok(mixedCsv.csv.includes(',-3,'), 'debit cells remain numeric');
assert.ok(
  mixedResult.sampledIncrementalBytes <= 64 * MiB,
  'mixed history processing stays within 64MiB incremental budget',
);
assert.ok(
  performance.now() - mixedStarted < 10000,
  'mixed history local processing deadline',
);
assert.ok(Buffer.byteLength(mixedCsv.csv, 'utf8') <= 3 * MiB);
console.log(
  JSON.stringify({
    mixedHistoryExport: mixedResult,
    eventCount: mixedCsv.eventCount,
    rowCount: mixedCsv.rowCount,
    csvBytes: Buffer.byteLength(mixedCsv.csv, 'utf8'),
  }),
);
