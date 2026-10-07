import { z } from 'zod';
import { payloadSchemas } from '@/features/inventory/contracts';
import {
  boundedJSON,
  creationRecoveryLimits,
  inputsSchema,
} from './creation-recovery';
import { equalValue, type RecordMetadata } from './reconciliation';

const uuid = z.uuid();
const text = z.string().max(4000);
const nullableText = text.nullable();
const metadata = {
  id: uuid,
  name: text,
  description: nullableText,
  categoryId: uuid,
  categoryName: text,
  manufacturer: nullableText,
  model: nullableText,
  version: z.number().int().positive(),
  customValues: z
    .record(
      uuid,
      z.strictObject({ value: z.unknown(), validated_revision_id: uuid }),
    )
    .optional(),
  validatedFormRevisionId: uuid.nullable().optional(),
  needsMetadata: z.boolean().optional(),
  customDisplay: z
    .record(
      uuid,
      z.strictObject({
        value: z.unknown(),
        validated_revision_id: uuid,
        label: text,
        field_type: text,
        option_paths: z.array(z.array(text).max(64)).max(1000),
        legacy: z.boolean(),
        category_id: uuid.optional(),
        current_published_revision_id: uuid.optional(),
      }),
    )
    .optional(),
};
const baselineSchema = z.union([
  z.strictObject({
    ...metadata,
    archived: z.boolean(),
    itemCode: nullableText,
    reorderThreshold: z.number().int().nonnegative().nullable(),
  }),
  z.strictObject({
    ...metadata,
    status: z.enum(['active', 'retired']),
    assetTag: nullableText,
    serialNumber: nullableText,
  }),
]);
/** Whitelist only metadata used by reconciliation; never retain files or credentials. */
export function editBaseline(record: RecordMetadata): RecordMetadata {
  const shared: Record<string, unknown> = Object.fromEntries(
    Object.keys(metadata)
      .filter((key) => Object.hasOwn(record, key))
      .map((key) => [key, record[key as keyof RecordMetadata]]),
  );
  if (record.customValues)
    shared.customValues = Object.fromEntries(
      Object.entries(record.customValues).map(([id, entry]) => [
        id,
        {
          value: entry.value,
          validated_revision_id: entry.validated_revision_id,
        },
      ]),
    );
  if (record.customDisplay)
    shared.customDisplay = Object.fromEntries(
      Object.entries(record.customDisplay).map(([id, entry]) => [
        id,
        Object.fromEntries(
          Object.entries(entry).filter(([key]) =>
            [
              'value',
              'validated_revision_id',
              'label',
              'field_type',
              'option_paths',
              'legacy',
              'category_id',
              'current_published_revision_id',
            ].includes(key),
          ),
        ),
      ]),
    );
  return baselineSchema.parse(
    !('status' in record)
      ? {
          ...shared,
          archived: record.archived,
          itemCode: record.itemCode,
          reorderThreshold: record.reorderThreshold,
        }
      : {
          ...shared,
          status: record.status,
          assetTag: record.assetTag,
          serialNumber: record.serialNumber,
        },
  );
}
const scopeSchema = z.strictObject({
  origin: z.url(),
  backend: z.url(),
  actor: uuid,
  kind: z.enum(['quantity', 'asset']),
  entity: uuid,
  task: z.literal('metadata'),
});
export type EditScope = z.infer<typeof scopeSchema>;
const commandSchema = z.strictObject({
  operation: z.enum(['quantity_update_v2', 'asset_update_v2']),
  requestId: uuid,
  expectedActorId: uuid,
  payload: z.record(z.string(), z.unknown()),
});
export type EditCommand = z.infer<typeof commandSchema>;
const envelopeSchema = z
  .strictObject({
    version: z.literal(1),
    scope: scopeSchema,
    instance: uuid,
    sequence: z.number().int().nonnegative(),
    status: z.enum(['editing', 'submitted', 'saved', 'discarded']),
    baseline: baselineSchema,
    inputs: inputsSchema.nullable(),
    command: commandSchema.nullable(),
    completedRequestId: uuid.nullable(),
  })
  .superRefine((value, ctx) => {
    const command = value.command;
    if (
      value.baseline.id !== value.scope.entity ||
      'archived' in value.baseline !== (value.scope.kind === 'quantity') ||
      (value.status === 'submitted') !== !!command ||
      (value.status === 'editing' || value.status === 'submitted') !==
        !!value.inputs ||
      (value.status === 'saved') !== !!value.completedRequestId ||
      (command &&
        (command.operation !== `${value.scope.kind}_update_v2` ||
          command.expectedActorId !== value.scope.actor ||
          command.payload[
            value.scope.kind === 'quantity' ? 'item_id' : 'asset_id'
          ] !== value.scope.entity ||
          command.payload.expected_version !== value.baseline.version ||
          !payloadSchemas[command.operation].safeParse(command.payload)
            .success))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent metadata recovery identity or state',
      });
  });
export type EditEnvelope = z.infer<typeof envelopeSchema>;
const prefix = 'inventory-metadata-edit-v1:';
const bytes = (raw: string) => new TextEncoder().encode(raw).length;
const keyFor = (scope: EditScope) =>
  prefix +
  JSON.stringify([
    scope.origin,
    scope.backend,
    scope.actor,
    scope.kind,
    scope.entity,
    scope.task,
  ]);
// Session generations survive mounted/pristine tasks without consuming storage.
// Removing a terminal receipt must not make an older null-baseline writer current.
const generations = new Map<string, number>();
export type EditSession = { scope: EditScope; generation: number };
export function openEditSession(scope: EditScope): EditSession {
  return { scope, generation: generations.get(keyFor(scope)) ?? 0 };
}
const currentSession = (session: EditSession) =>
  session.generation === (generations.get(keyFor(session.scope)) ?? 0);
const advance = (key: string, session?: EditSession) => {
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  if (session) session.generation = generation;
};
/** Explicit discard only: never remove an uncertain command or another writer. */
export function removeEdit(
  previous: EditEnvelope | null,
  session: EditSession,
): boolean {
  try {
    if (!currentSession(session) || previous?.status === 'submitted')
      return false;
    const key = keyFor(session.scope),
      raw = sessionStorage.getItem(key);
    if (
      (raw && !parseEdit(raw, session.scope)) ||
      !equalValue(raw ? parseEdit(raw, session.scope) : null, previous)
    )
      return false;
    if (raw && previous?.status === 'editing') {
      sessionStorage.removeItem(key);
      if (sessionStorage.getItem(key) !== null) return false;
    }
    advance(key, session);
    return true;
  } catch {
    return false;
  }
}
export function parseEdit(raw: string, scope: EditScope): EditEnvelope | null {
  if (bytes(raw) > creationRecoveryLimits.entryBytes) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!boundedJSON(value)) return null;
    const result = envelopeSchema.safeParse(value);
    return result.success &&
      Object.keys(scope).every(
        (key) =>
          result.data.scope[key as keyof EditScope] ===
          scope[key as keyof EditScope],
      )
      ? result.data
      : null;
  } catch {
    return null;
  }
}
export function readEdit(scope: EditScope): {
  envelope: EditEnvelope | null;
  error?: string;
} {
  try {
    const raw = sessionStorage.getItem(keyFor(scope));
    const envelope = raw ? parseEdit(raw, scope) : null;
    return raw && !envelope
      ? {
          envelope: null,
          error:
            'Saved edit recovery is invalid or incompatible. It was retained without restoring or replacing its values.',
        }
      : { envelope };
  } catch {
    return { envelope: null, error: 'Recovery storage is unavailable.' };
  }
}
/** Compare-and-swap blocks stale mounts and preserves submitted request identity. */
export function writeEdit(
  next: EditEnvelope,
  previous: EditEnvelope | null,
  resolvedRequest?: string,
  session?: EditSession,
): boolean {
  try {
    if (
      session &&
      (!equalValue(session.scope, next.scope) || !currentSession(session))
    )
      return false;
    const key = keyFor(next.scope),
      raw = JSON.stringify(next);
    const parsedNext = parseEdit(raw, next.scope);
    if (!parsedNext) return false;
    const currentRaw = sessionStorage.getItem(key);
    const current = currentRaw ? parseEdit(currentRaw, next.scope) : null;
    if (current && equalValue(current, parsedNext))
      return (
        next.status !== 'saved' || next.completedRequestId === resolvedRequest
      );
    if (
      (currentRaw && !current) ||
      !equalValue(
        current,
        previous ? parseEdit(JSON.stringify(previous), next.scope) : null,
      )
    )
      return false;
    if (previous) {
      const terminal =
        previous.status === 'saved' || previous.status === 'discarded';
      if (terminal) {
        if (
          next.status !== 'editing' ||
          next.instance === previous.instance ||
          next.sequence !== 0
        )
          return false;
      } else if (
        next.instance !== previous.instance ||
        next.sequence !== previous.sequence + 1
      )
        return false;
      if (
        previous.status === 'submitted' &&
        (resolvedRequest !== previous.command?.requestId ||
          !['editing', 'saved'].includes(next.status))
      )
        return false;
      if (
        next.status === 'saved' &&
        (previous.status !== 'submitted' ||
          next.completedRequestId !== resolvedRequest)
      )
        return false;
    } else if (next.status !== 'editing' || next.sequence !== 0) return false;
    let count = 0,
      total = bytes(raw);
    const terminal: { key: string; raw: string }[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const candidate = sessionStorage.key(i);
      if (!candidate?.startsWith(prefix)) continue;
      count++;
      if (candidate === key) continue;
      const candidateRaw = sessionStorage.getItem(candidate) ?? '';
      total += bytes(candidateRaw);
      // A corrupt/oversized/mis-keyed entry is protected, not free capacity.
      let value: EditEnvelope | null = null;
      try {
        if (bytes(candidateRaw) > creationRecoveryLimits.entryBytes) continue;
        const candidateScope = scopeSchema.safeParse(
          JSON.parse(candidateRaw).scope,
        );
        if (candidateScope.success)
          value = parseEdit(candidateRaw, candidateScope.data);
      } catch {
        /* retain invalid data */
      }
      if (
        value &&
        keyFor(value.scope) === candidate &&
        (value.status === 'saved' || value.status === 'discarded')
      )
        terminal.push({ key: candidate, raw: candidateRaw });
    }
    const reclaim = () => {
      while (terminal.length) {
        const candidate = terminal.shift()!;
        if (sessionStorage.getItem(candidate.key) !== candidate.raw) continue;
        sessionStorage.removeItem(candidate.key);
        if (sessionStorage.getItem(candidate.key) !== null) continue;
        advance(candidate.key);
        count--;
        total -= bytes(candidate.raw);
        return true;
      }
      return false;
    };
    while (
      (!currentRaw && count >= creationRecoveryLimits.instances) ||
      total > creationRecoveryLimits.totalBytes
    ) {
      if (!reclaim()) return false;
    }
    // Browser quota may be lower than our bounded allocation (or shared with
    // other features). Only verified terminal receipts can make room.
    for (;;) {
      if (
        sessionStorage.getItem(key) !== currentRaw ||
        (session && !currentSession(session))
      )
        return false;
      try {
        sessionStorage.setItem(key, raw);
        break;
      } catch {
        if (!reclaim()) return false;
      }
    }
    if (sessionStorage.getItem(key) !== raw) return false;
    advance(key, session);
    return true;
  } catch {
    return false;
  }
}
