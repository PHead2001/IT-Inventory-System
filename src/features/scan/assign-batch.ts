import { z } from 'zod';
import { clearLabelQueueSession } from '@/features/labels/queue-model';
import { clearAllDesignerRecovery } from '@/features/metadata/designer-recovery';
import {
  assignmentCandidateSchema,
  assignmentContextSchema,
} from './assign-contracts';
import type { AssignState } from './assign-state';
import type { AssignmentScope, AssignmentRecovery } from './assign-recovery';

export const BATCH_LIMIT = 200;
export const BATCH_BYTES = 1048576;
const entrySchema = z
  .strictObject({
    id: z.uuid(),
    status: z.enum(['pending', 'uncertain', 'success', 'failed', 'skipped']),
    name: z.string().max(200),
    kind: z.enum(['asset', 'quantity']).nullable(),
    entityId: z.uuid().nullable(),
    identifier: z.string().max(200).nullable(),
    units: z.number().int().min(0).max(2147483647),
    source: z.string().max(500),
    context: assignmentContextSchema,
    requestId: z.uuid().nullable(),
    eventId: z.uuid().nullable(),
    message: z.string().max(500),
  })
  .superRefine((row, ctx) => {
    if (
      (row.status === 'success' &&
        (!row.eventId ||
          !row.requestId ||
          !row.kind ||
          !row.entityId ||
          row.units < 1)) ||
      (row.status !== 'success' && row.eventId) ||
      (row.status === 'uncertain' && !row.requestId)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid batch outcome.' });
  });
const schema = z
  .strictObject({
    version: z.literal(1),
    scope: z.strictObject({
      actor: z.uuid(),
      origin: z.url(),
      backend: z.url(),
    }),
    context: assignmentContextSchema.nullable(),
    entries: z.array(entrySchema).max(BATCH_LIMIT),
    historical: z
      .strictObject({
        candidate: assignmentCandidateSchema,
        sourceId: z.string().max(36),
        units: z.string().max(20),
        entryId: z.uuid(),
      })
      .nullable(),
    finished: z.boolean(),
  })
  .superRefine((value, ctx) => {
    for (const field of ['id', 'requestId', 'eventId'] as const) {
      const ids = value.entries.map((row) => row[field]).filter(Boolean);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: 'custom', message: 'Duplicate batch identity.' });
    }
    if (
      value.entries.filter((row) => row.status === 'uncertain').length > 1 ||
      (value.historical &&
        !value.entries.some((row) => row.id === value.historical?.entryId))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid batch inspection.' });
  });
export type BatchEntry = z.infer<typeof entrySchema>;
export type AssignmentBatch = z.infer<typeof schema>;
export const batchKey = (scope: AssignmentScope) =>
  'inventory-assign-batch-v1:' +
  JSON.stringify([scope.origin, scope.backend, scope.actor]);
export const emptyBatch = (scope: AssignmentScope): AssignmentBatch => ({
  version: 1,
  scope,
  context: null,
  entries: [],
  historical: null,
  finished: false,
});
export function parseBatch(
  raw: string,
  scope: AssignmentScope,
): AssignmentBatch | null {
  if (new TextEncoder().encode(raw).length > BATCH_BYTES) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success &&
      JSON.stringify(parsed.data.scope) === JSON.stringify(scope)
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
export function readBatch(scope: AssignmentScope) {
  try {
    const raw = sessionStorage.getItem(batchKey(scope));
    return {
      raw,
      value: raw ? parseBatch(raw, scope) : null,
      blocked: !!raw && !parseBatch(raw, scope),
    };
  } catch {
    return { raw: null, value: null, blocked: true };
  }
}
export function storeBatch(
  value: AssignmentBatch,
  previousRaw: string | null,
): string | null {
  try {
    const raw = JSON.stringify(value);
    if (
      !parseBatch(raw, value.scope) ||
      sessionStorage.getItem(batchKey(value.scope)) !== previousRaw
    )
      return null;
    sessionStorage.setItem(batchKey(value.scope), raw);
    return sessionStorage.getItem(batchKey(value.scope)) === raw ? raw : null;
  } catch {
    return null;
  }
}
export function clearBatch(
  scope: AssignmentScope,
  previousRaw: string | null,
): boolean {
  try {
    if (sessionStorage.getItem(batchKey(scope)) !== previousRaw) return false;
    sessionStorage.removeItem(batchKey(scope));
    return sessionStorage.getItem(batchKey(scope)) === null;
  } catch {
    return false;
  }
}
export function terminalFits(value: AssignmentBatch): boolean {
  // Reserve space for a UUID event, bounded error text and all terminal serialization.
  return (
    new TextEncoder().encode(JSON.stringify(value)).length <= BATCH_BYTES - 4096
  );
}
export function recoveryEntry(
  recovery: AssignmentRecovery,
  id: string,
): BatchEntry {
  return {
    id,
    status: 'uncertain',
    name: recovery.candidate.name,
    kind: recovery.candidate.kind,
    entityId: recovery.candidate.id,
    identifier: recovery.candidate.identifier,
    units: Number(recovery.units),
    source:
      recovery.candidate.sources.find((row) => row.id === recovery.sourceId)
        ?.name ?? 'Unavailable source',
    context: { ...recovery.context },
    requestId: recovery.command.requestId,
    eventId: null,
    message: '',
  };
}
export function matchesRecoveryEntry(
  row: BatchEntry,
  recovery: AssignmentRecovery,
): boolean {
  const expected = recoveryEntry(recovery, row.id);
  return (
    (
      [
        'name',
        'kind',
        'entityId',
        'identifier',
        'units',
        'source',
        'requestId',
      ] as const
    ).every((key) => row[key] === expected[key]) &&
    JSON.stringify(row.context) === JSON.stringify(expected.context)
  );
}
export function batchTotals(entries: BatchEntry[]) {
  const successful = entries.filter((row) => row.status === 'success');
  return {
    assetAssignments: successful.filter((row) => row.kind === 'asset').length,
    assets: new Set(
      successful
        .filter((row) => row.kind === 'asset')
        .map((row) => row.entityId),
    ).size,
    quantityAssignments: successful.filter((row) => row.kind === 'quantity')
      .length,
    units: successful
      .filter((row) => row.kind === 'quantity')
      .reduce((sum, row) => sum + row.units, 0),
    failed: entries.filter((row) => row.status === 'failed').length,
    skipped: entries.filter((row) => row.status === 'skipped').length,
    pending: entries.filter((row) => row.status === 'pending').length,
    uncertain: entries.filter((row) => row.status === 'uncertain').length,
  };
}
/** An interrupted read has no command to replay or retained review to reopen. */
export function reconcileInterruptedLookups(
  value: AssignmentBatch,
): AssignmentBatch {
  let changed = false;
  const entries = value.entries.map((row) => {
    if (
      row.status !== 'pending' ||
      row.requestId !== null ||
      row.id === value.historical?.entryId
    )
      return row;
    changed = true;
    return {
      ...row,
      status: 'skipped' as const,
      message:
        'Inspection interrupted before confirmation. Nothing was submitted.',
    };
  });
  return changed ? { ...value, entries } : value;
}
export function historicalInspection(
  state: AssignState,
  entryId: string,
): AssignmentBatch['historical'] {
  return state.candidate
    ? {
        candidate: state.candidate,
        sourceId: state.sourceId,
        units: state.units,
        entryId,
      }
    : null;
}

// This module lives beyond the scan route. Unmounted callbacks retain a captured
// epoch, and can never repopulate storage after privacy invalidation.
let epoch = 0;
const invalidationListeners = new Set<() => void>();
export function subscribeAssignmentInvalidation(listener: () => void) {
  invalidationListeners.add(listener);
  return () => {
    invalidationListeners.delete(listener);
  };
}
let activeScope: string | null = null;
let cleanupRequired: 'all' | 'private' | null = null;
let authoritativeCleanupRevision = 0;
const cleanupListeners = new Set<() => void>();
let privacyRevocationRevision = 0;
const revocationListeners = new Set<() => void>();
export const readPrivacyRevocationRevision = () => privacyRevocationRevision;
export function subscribePrivacyRevocation(listener: () => void) {
  revocationListeners.add(listener);
  return () => {
    revocationListeners.delete(listener);
  };
}
/** Known revocation masks retained owners before attempting any storage wipe. */
export function revokePrivatePresentation() {
  privacyRevocationRevision++;
  for (const listener of revocationListeners) listener();
  invalidateAssignmentCallbacks();
}
export const readAuthoritativeCleanupRevision = () =>
  authoritativeCleanupRevision;
export function subscribeAuthoritativeCleanup(listener: () => void) {
  cleanupListeners.add(listener);
  return () => {
    cleanupListeners.delete(listener);
  };
}
export const assignmentEpoch = () => epoch;
export function adoptAssignmentScope(scope: AssignmentScope) {
  const identity = batchKey(scope);
  const tombstone = sessionStorage.getItem('inventory-assign-cleanup-v1');
  if (tombstone && tombstone !== 'all' && tombstone !== 'private')
    throw new Error('Unrecognized assignment cleanup state.');
  const previous = sessionStorage.getItem('inventory-assign-scope-v1');
  const fallback =
    previous === 'cleanup:all'
      ? 'all'
      : previous === 'cleanup:private'
        ? 'private'
        : null;
  const cleanup = strongestCleanup(
    cleanupRequired,
    tombstone as 'all' | 'private' | null,
    fallback,
  );
  if (cleanup && !clearAssignmentPrivacyStorage(cleanup))
    throw new Error('Assignment privacy cleanup is unavailable.');
  const priorIdentity = cleanup ? null : previous;
  if (
    (activeScope && activeScope !== identity) ||
    (priorIdentity && priorIdentity !== identity)
  )
    if (!invalidateAssignmentPrivacy(false))
      throw new Error('Assignment privacy cleanup is unavailable.');
  sessionStorage.setItem('inventory-assign-scope-v1', identity);
  activeScope = identity;
  return epoch;
}
export function invalidateAssignmentCallbacks() {
  epoch++;
  for (const listener of invalidationListeners) listener();
  if (typeof window !== 'undefined')
    window.dispatchEvent(new Event('assignment-scope-invalidated'));
}
/** Only a durable authoritative all-cleanup marker permits auth-entry deletion. */
export function readAuthoritativeLogoutCleanup():
  'pending' | 'none' | 'blocked' {
  try {
    const marker = sessionStorage.getItem('inventory-assign-cleanup-v1');
    const scopeMarker = sessionStorage.getItem('inventory-assign-scope-v1');
    if (
      (marker !== null && marker !== 'all' && marker !== 'private') ||
      (scopeMarker?.startsWith('cleanup:') &&
        scopeMarker !== 'cleanup:all' &&
        scopeMarker !== 'cleanup:private')
    )
      return 'blocked';
    return marker === 'all' || scopeMarker === 'cleanup:all'
      ? 'pending'
      : 'none';
  } catch {
    return 'blocked';
  }
}
function strongestCleanup(...modes: ('all' | 'private' | null)[]) {
  return modes.includes('all')
    ? 'all'
    : modes.includes('private')
      ? 'private'
      : null;
}
function clearAssignmentPrivacyStorage(mode: 'all' | 'private') {
  cleanupRequired = strongestCleanup(cleanupRequired, mode);
  try {
    const marker = sessionStorage.getItem('inventory-assign-cleanup-v1');
    const scopeMarker = sessionStorage.getItem('inventory-assign-scope-v1');
    mode = strongestCleanup(
      cleanupRequired,
      marker === 'all' ? 'all' : null,
      scopeMarker === 'cleanup:all' ? 'all' : null,
    )!;
    cleanupRequired = mode;
    // Quota must not prevent deletions. Replacing an existing scope marker is
    // a bounded fallback when inserting a new cleanup tombstone cannot fit.
    const establishMarker = () => {
      try {
        sessionStorage.setItem('inventory-assign-cleanup-v1', mode);
      } catch {
        try {
          sessionStorage.setItem(
            'inventory-assign-scope-v1',
            `cleanup:${mode}`,
          );
        } catch {
          /* Removal and verification still run. */
        }
      }
    };
    establishMarker();
    const targets: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      // Account/environment changes preserve exact uncertain recovery.
      if (
        key?.startsWith('inventory-assign-batch-v1:') ||
        (mode === 'all' &&
          (key?.startsWith('inventory-assign-v1:') ||
            key?.startsWith('it-inventory-label-queue:v1:')))
      )
        targets.push(key);
    }
    let absent = true;
    for (const key of targets) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Verify independently. */
      }
      try {
        if (sessionStorage.getItem(key) !== null) absent = false;
      } catch {
        absent = false;
      }
    }
    // Keep the strongest tombstone until the independently verified label helper
    // also proves that every queue namespace is absent.
    if (mode === 'all' && !clearLabelQueueSession()) absent = false;
    if (mode === 'all' && !clearAllDesignerRecovery()) absent = false;
    if (!absent) {
      // Successful independent deletions may have freed marker capacity.
      establishMarker();
      return false;
    }
    sessionStorage.removeItem('inventory-assign-scope-v1');
    if (sessionStorage.getItem('inventory-assign-scope-v1') !== null)
      return false;
    sessionStorage.removeItem('inventory-assign-cleanup-v1');
    if (sessionStorage.getItem('inventory-assign-cleanup-v1') !== null)
      return false;
    cleanupRequired = null;
    // Publish only a complete authoritative wipe, including observer and scope-
    // adoption paths. Callback invalidation alone is not storage erasure authority.
    if (mode === 'all') {
      authoritativeCleanupRevision++;
      for (const listener of cleanupListeners) listener();
    }
    return true;
  } catch {
    return false;
  }
}
export function invalidateAssignmentPrivacy(
  authoritativeLogout: boolean,
  revoke = true,
): boolean {
  if (revoke) revokePrivatePresentation();
  else invalidateAssignmentCallbacks();
  const cleared = clearAssignmentPrivacyStorage(
    authoritativeLogout ? 'all' : 'private',
  );
  if (cleared) activeScope = null;
  return cleared;
}
