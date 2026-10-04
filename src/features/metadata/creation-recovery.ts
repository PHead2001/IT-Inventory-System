import { z } from 'zod';
import { formEnvelope } from './contracts';
import { payloadSchemas } from '@/features/inventory/contracts';
import { custodySchemas } from '@/features/custody/contracts';
import type { CoreValues } from './reconciliation';
import { equalValue } from './reconciliation';

// Application ceilings; browsers may impose a smaller quota. Nothing is evicted.
export const creationRecoveryLimits = {
  entryBytes: 2 * 1024 * 1024,
  totalBytes: 8 * 1024 * 1024,
  instances: 32,
};
const prefix = 'inventory-creation-v1:';
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const creationDraftId = (value: unknown) =>
  uuid.safeParse(value).success ? (value as string) : undefined;
const scopeSchema = z.strictObject({
  origin: z.url(),
  backend: z.url(),
  actor: uuid,
  kind: z.enum(['quantity', 'asset']),
  site: uuid.nullable(),
});
export type CreationScope = z.infer<typeof scopeSchema>;
const coreSchema = z.strictObject(
  Object.fromEntries(
    [
      'name',
      'description',
      'category_id',
      'manufacturer',
      'model',
      'reorder_threshold',
      'item_code',
      'asset_tag',
      'serial_number',
      'initial_quantity',
      'initial_location_id',
      'location_id',
    ].map((key) => [key, z.string().max(4000)]),
  ) as Record<keyof CoreValues, z.ZodString>,
);
const answers = z
  .record(uuid, z.unknown())
  .refine((value) => Object.keys(value).length <= 100);
const published = formEnvelope
  .strict()
  .extend({
    draft_id: z.null(),
    draft_version: z.null(),
    draft_definition: z.null(),
  })
  .refine((form) => {
    const definition = form.published_definition;
    return (
      definition.fields.length <= 100 &&
      definition.layout.length <= 101 &&
      definition.layout.every((section) => section.controls.length <= 200) &&
      definition.fields.every((field) => field.options.length <= 1000) &&
      definition.fields.reduce((sum, field) => sum + field.options.length, 0) <=
        5000
    );
  });
const snapshots = z
  .record(uuid, published)
  .refine(
    (value) =>
      Object.keys(value).length <= 32 &&
      Object.entries(value).every(([key, form]) => form.category_id === key),
  );
const inputsSchema = z.strictObject({
  core: coreSchema,
  cleanCore: coreSchema,
  custom: answers,
  touched: z.array(uuid).max(100),
  reviewedForms: snapshots,
  priorForms: snapshots,
  dateTimes: z
    .record(
      uuid,
      z.strictObject({
        wall: z.string().max(64),
        zone: z
          .string()
          .max(100)
          .refine((zone) => {
            try {
              new Intl.DateTimeFormat('en', { timeZone: zone });
              return true;
            } catch {
              return false;
            }
          }),
      }),
    )
    .refine((value) => Object.keys(value).length <= 100),
  openingQuantity: z.string().max(100),
  openingReason: z.string().max(2000),
  openingReference: z.string().max(200),
});
export type CreationInputs = z.infer<typeof inputsSchema>;
const commandSchema = z.strictObject({
  operation: z.enum([
    'quantity_create_v2',
    'asset_create_v2',
    'quantity_site_open',
    'asset_site_open',
  ]),
  requestId: uuid,
  expectedActorId: uuid,
  payload: z.record(z.string(), z.unknown()),
});
export type CreationCommand = z.infer<typeof commandSchema>;
const envelopeSchema = z
  .strictObject({
    version: z.literal(1),
    scope: scopeSchema,
    instance: uuid,
    status: z.enum(['editing', 'submitted', 'saved', 'discarded']),
    inputs: inputsSchema.nullable(),
    command: commandSchema.nullable(),
    entityId: uuid.nullable(),
    completedRequestId: uuid.nullable(),
  })
  .superRefine((value, ctx) => {
    const submitted = value.status === 'submitted';
    if (
      submitted !== !!value.command ||
      (value.status === 'editing' || submitted) !== !!value.inputs ||
      (value.status === 'saved') !== !!value.entityId ||
      (value.status === 'saved') !== !!value.completedRequestId
    )
      ctx.addIssue({ code: 'custom', message: 'Inconsistent creation state' });
    if (
      value.command &&
      (value.command.expectedActorId !== value.scope.actor ||
        value.command.operation !==
          `${value.scope.kind}_${value.scope.site ? 'site_open' : 'create_v2'}` ||
        (value.scope.site
          ? value.command.payload.site_id !== value.scope.site
          : Object.hasOwn(value.command.payload, 'site_id')))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent creation command',
      });
    if (value.command) {
      const { operation, payload } = value.command;
      const schema =
        operation === 'quantity_site_open' || operation === 'asset_site_open'
          ? custodySchemas[operation]
          : payloadSchemas[operation];
      if (!schema.safeParse(payload).success)
        ctx.addIssue({ code: 'custom', message: 'Invalid creation payload' });
    }
  });
export type CreationEnvelope = z.infer<typeof envelopeSchema>;
const boundedJSON = (value: unknown, depth = 0): boolean => {
  if (depth > 12) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= 300000;
  if (Array.isArray(value))
    return (
      value.length <= 6000 &&
      value.every((entry) => boundedJSON(entry, depth + 1))
    );
  return (
    !!value &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.entries(value).length <= 6000 &&
    Object.entries(value).every(
      ([key, entry]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) &&
        boundedJSON(entry, depth + 1),
    )
  );
};
const bytes = (value: string) => new TextEncoder().encode(value).length;
const keyFor = (scope: CreationScope, instance: string) =>
  prefix +
  JSON.stringify([
    scope.origin,
    scope.backend,
    scope.actor,
    scope.kind,
    scope.site,
    instance,
  ]);
export function parseCreationEnvelope(
  raw: string,
  scope: CreationScope,
  instance: string,
): CreationEnvelope | null {
  if (bytes(raw) > creationRecoveryLimits.entryBytes) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!boundedJSON(value)) return null;
    const result = envelopeSchema.safeParse(value);
    return result.success &&
      Object.keys(scope).every(
        (key) =>
          result.data.scope[key as keyof CreationScope] ===
          scope[key as keyof CreationScope],
      ) &&
      result.data.instance === instance
      ? result.data
      : null;
  } catch {
    return null;
  }
}
export const recoveryLimitation =
  'Recovery storage is unavailable or full. Keep this form open: browser and internal navigation may lose these entries. Refresh and tab closure use the browser’s unsaved-changes warning. Saving is paused until the original request can be stored safely.';
export function readCreation(
  scope: CreationScope,
  instance: string,
): { envelope: CreationEnvelope | null; error?: string } {
  try {
    const raw = sessionStorage.getItem(keyFor(scope, instance));
    const envelope = raw ? parseCreationEnvelope(raw, scope, instance) : null;
    return raw && !envelope
      ? {
          envelope: null,
          error:
            'This recovery data is incompatible or invalid. It has been retained without restoring or rewriting its answers.',
        }
      : { envelope };
  } catch {
    return { envelope: null, error: recoveryLimitation };
  }
}
export function writeCreation(
  envelope: CreationEnvelope,
  resolvedRequest?: string,
): boolean {
  try {
    const key = keyFor(envelope.scope, envelope.instance);
    const raw = JSON.stringify(envelope);
    if (!parseCreationEnvelope(raw, envelope.scope, envelope.instance))
      return false;
    const previousRaw = sessionStorage.getItem(key);
    const previous = previousRaw
      ? parseCreationEnvelope(previousRaw, envelope.scope, envelope.instance)
      : null;
    if (previousRaw && !previous) return false;
    if (previous?.status === 'saved' || previous?.status === 'discarded')
      return previousRaw === raw;
    if (
      envelope.status === 'saved' &&
      (previous?.status !== 'submitted' ||
        resolvedRequest !== previous.command?.requestId ||
        envelope.completedRequestId !== resolvedRequest)
    )
      return false;
    if (previous?.status === 'submitted') {
      if (envelope.status === 'submitted')
        return equalValue(previous, envelope);
      if (
        envelope.status === 'discarded' ||
        (envelope.status === 'editing' &&
          resolvedRequest !== previous.command?.requestId)
      )
        return false;
    }
    let count = 0,
      total = bytes(raw);
    for (let i = 0; i < sessionStorage.length; i++) {
      const candidate = sessionStorage.key(i);
      if (!candidate?.startsWith(prefix)) continue;
      count++;
      if (candidate !== key)
        total += bytes(sessionStorage.getItem(candidate) ?? '');
    }
    if (
      (!previousRaw && count >= creationRecoveryLimits.instances) ||
      total > creationRecoveryLimits.totalBytes
    )
      return false;
    sessionStorage.setItem(key, raw);
    return sessionStorage.getItem(key) === raw;
  } catch {
    return false;
  }
}
export function pendingCreations(
  scope: CreationScope,
  except: string,
): CreationEnvelope[] {
  const result: CreationEnvelope[] = [];
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const identity: unknown = JSON.parse(key.slice(prefix.length));
      if (
        !Array.isArray(identity) ||
        identity.length !== 6 ||
        !creationDraftId(identity[5]) ||
        identity[5] === except
      )
        continue;
      const envelope = parseCreationEnvelope(
        sessionStorage.getItem(key) ?? '',
        scope,
        identity[5],
      );
      if (
        envelope?.inputs &&
        (envelope.status === 'submitted' ||
          JSON.stringify(envelope.inputs.core) !==
            JSON.stringify(envelope.inputs.cleanCore) ||
          envelope.inputs.touched.length ||
          Object.keys(envelope.inputs.dateTimes).length ||
          envelope.inputs.openingQuantity !== '1' ||
          envelope.inputs.openingReason ||
          envelope.inputs.openingReference)
      )
        result.push(envelope);
    }
  } catch {
    /* The active form reports storage failure. */
  }
  return result;
}
export function creationURL(instance: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('draft', instance);
  return url.pathname + url.search + url.hash;
}
export function publishedSnapshots(
  forms: Record<string, import('./contracts').MetadataForm>,
) {
  return Object.fromEntries(
    Object.entries(forms).map(([id, form]) => [
      id,
      { ...form, draft_id: null, draft_version: null, draft_definition: null },
    ]),
  );
}
