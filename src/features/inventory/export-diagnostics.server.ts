import 'server-only';
import { randomUUID } from 'node:crypto';

type Stage =
  | 'started'
  | 'authenticated'
  | 'member_checked'
  | 'session_checked'
  | 'snapshot_requested'
  | 'raw_chunk'
  | 'raw_read'
  | 'json_parsed'
  | 'snapshot_finished'
  | 'csv_row'
  | 'csv_encoded'
  | 'response_ready'
  | 'complete';

// This is deliberately server-only and opt-in. No request payload, URL,
// identity, inventory value, filter or auth material is ever retained here.
export function createExportDiagnostics(generateId: () => string = randomUUID) {
  if (
    process.env.VERCEL_ENV !== 'preview' ||
    process.env.EXPORT_DIAGNOSTICS_ENABLED !== 'true'
  )
    return null;

  let diagnosticId: string;
  let start: number;
  let baseline: NodeJS.MemoryUsage;
  try {
    diagnosticId = generateId();
    start = performance.now();
    baseline = process.memoryUsage();
  } catch {
    return null;
  }
  const baselineCombined = baseline.heapUsed + baseline.external;
  const elapsedMs: Partial<Record<Stage, number>> = {};
  let rawResponseBytes: number | null = null;
  let csvBytes: number | null = null;
  let sampledHeapExternalDeltaBytes = 0;
  let sampledRssDeltaBytes = 0;
  let emitted = false;

  const sample = (stage: Stage) => {
    try {
      const current = process.memoryUsage();
      elapsedMs[stage] = Math.round(performance.now() - start);
      sampledHeapExternalDeltaBytes = Math.max(
        sampledHeapExternalDeltaBytes,
        current.heapUsed + current.external - baselineCombined,
      );
      sampledRssDeltaBytes = Math.max(
        sampledRssDeltaBytes,
        current.rss - baseline.rss,
      );
    } catch {
      // Diagnostics cannot change the export result.
    }
  };
  sample('started');

  return {
    id: diagnosticId,
    sample,
    readerStage(
      stage: 'raw_chunk' | 'raw_read' | 'json_parsed',
      bytes: number,
    ) {
      if (stage === 'raw_chunk' || stage === 'raw_read')
        rawResponseBytes = bytes;
      sample(stage);
    },
    csvRow(bytes: number) {
      csvBytes = bytes;
      sample('csv_row');
    },
    csvEncoded(bytes: number) {
      csvBytes = bytes;
      sample('csv_encoded');
    },
    emit() {
      if (emitted) return;
      emitted = true;
      sample('complete');
      try {
        console.info(
          JSON.stringify({
            event: 'inventory_export_diagnostic',
            diagnostic_id: diagnosticId,
            raw_response_bytes: rawResponseBytes,
            csv_bytes: csvBytes,
            elapsed_ms: elapsedMs,
            sampled_heap_external_delta_bytes: sampledHeapExternalDeltaBytes,
            sampled_rss_delta_bytes: sampledRssDeltaBytes,
          }),
        );
      } catch {
        // Logging cannot change the export result.
      }
    },
  };
}
