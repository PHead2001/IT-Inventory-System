import assert from 'node:assert/strict';

/** The legacy receive RPC accepts a positive JSON int32, not a decimal string.
 * Validate its exact decimal representation before the only Number conversion. */
export function legacyReceiveVersion(value: unknown): number {
  assert.ok(
    typeof value === 'string',
    'receive version must be a decimal string',
  );
  assert.match(
    value,
    /^[1-9][0-9]*$/,
    'receive version must be canonical and positive',
  );
  assert.ok(
    value.length <= 10,
    'receive version exceeds the legacy int32 boundary',
  );
  const exact = BigInt(value);
  assert.ok(
    exact <= 2147483647n,
    'receive version exceeds the legacy int32 boundary',
  );
  return Number(exact);
}

/** AbortSignal.timeout requires integer milliseconds. Round down so an
 * individual request never receives more than the readiness window remaining. */
export function remainingReadinessMs(deadline: number, now: number): number {
  assert.ok(
    Number.isFinite(deadline) && Number.isFinite(now),
    'finite readiness clock required',
  );
  const remaining = Math.floor(deadline - now);
  assert.ok(
    remaining >= 1 && remaining <= 2000,
    'local probe schema cache unavailable',
  );
  return remaining;
}
