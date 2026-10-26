export function probeFailureMarker(stage: unknown, reason: unknown): string;
export function extractProbeFailure(transcript: unknown): string;
export function classifyProbeFailure(error: unknown): string;
export function childFailureDiagnostic(
  signal: string | null,
  deadlineFired: boolean,
  diagnostic: unknown,
): string;
