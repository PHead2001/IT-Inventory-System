import { z } from 'zod';
import {
  boundedJSON,
  creationRecoveryLimits,
} from '@/features/metadata/creation-recovery';
import { parseCustodyCommand, type CustodyState } from './contracts';

const id = z.uuid();
const version = z.string().regex(/^[1-9][0-9]*$/);
const scopeSchema = z.strictObject({
  origin: z.url(),
  backend: z.url(),
  actor: id,
  site: id.nullable(),
  draft: id,
});
export type SiteRecoveryScope = z.infer<typeof scopeSchema>;
const siteSchema = z.strictObject({
  id,
  code: z.string().max(100),
  name: z.string().max(200),
  notes: z.string().max(2000).nullable(),
  active: z.boolean(),
  version,
});
const valuesSchema = z.strictObject({
  code: z.string().max(100),
  name: z.string().max(200),
  notes: z.string().max(2000),
});
const commandSchema = z.strictObject({
  operation: z.enum(['site_create', 'site_update', 'site_set_active']),
  requestId: id,
  expectedActorId: id,
  payload: z.record(z.string(), z.unknown()),
});
export type SiteRecoveryCommand = z.infer<typeof commandSchema>;
const envelopeSchema = z
  .strictObject({
    version: z.literal(1),
    scope: scopeSchema,
    instance: id,
    sequence: z.number().int().nonnegative(),
    status: z.enum(['editing', 'submitted', 'saved', 'discarded']),
    baseline: siteSchema.nullable(),
    values: valuesSchema,
    lifecycle: z.strictObject({ active: z.boolean(), version }).nullable(),
    reason: z.string().max(2000),
    command: commandSchema.nullable(),
    completion: z
      .strictObject({ entityId: id, version, changed: z.boolean() })
      .nullable(),
  })
  .superRefine((value, ctx) => {
    const command = value.command;
    if (
      value.baseline?.id !== (value.scope.site ?? undefined) ||
      (value.status === 'submitted') !== !!command ||
      (value.status === 'saved') !== !!value.completion ||
      (value.lifecycle &&
        (!value.baseline ||
          value.lifecycle.version !== value.baseline.version)) ||
      (command &&
        (!parseCustodyCommand(command).success ||
          command.expectedActorId !== value.scope.actor ||
          (value.scope.site
            ? command.operation === 'site_create' ||
              command.payload.site_id !== value.scope.site ||
              command.payload.expected_version !== value.baseline?.version
            : command.operation !== 'site_create')))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent site recovery identity or state.',
      });
  });
export type SiteRecoveryEnvelope = z.infer<typeof envelopeSchema>;
const prefix = 'inventory-site-task-v1:';
const keyFor = (scope: SiteRecoveryScope) =>
  prefix +
  JSON.stringify([
    scope.origin,
    scope.backend,
    scope.actor,
    scope.site,
    scope.draft,
  ]);
const bytes = (value: string) => new TextEncoder().encode(value).length;
export function parseSiteRecovery(
  raw: string,
  scope: SiteRecoveryScope,
): SiteRecoveryEnvelope | null {
  const parsed = parseStoredEnvelope(raw);
  return parsed &&
    Object.keys(scope).every(
      (key) =>
        parsed.scope[key as keyof SiteRecoveryScope] ===
        scope[key as keyof SiteRecoveryScope],
    )
    ? parsed
    : null;
}
function parseStoredEnvelope(raw: string): SiteRecoveryEnvelope | null {
  if (bytes(raw) > 65536) return null;
  try {
    const json: unknown = JSON.parse(raw);
    if (!boundedJSON(json)) return null;
    const parsed = envelopeSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
export function readSiteRecovery(scope: SiteRecoveryScope) {
  try {
    const raw = sessionStorage.getItem(keyFor(scope));
    const envelope = raw ? parseSiteRecovery(raw, scope) : null;
    return { envelope, blocked: !!raw && !envelope };
  } catch {
    return { envelope: null, blocked: true };
  }
}
export function writeSiteRecovery(
  next: SiteRecoveryEnvelope,
  previous: SiteRecoveryEnvelope | null,
  resolved?: string,
) {
  try {
    const raw = JSON.stringify(next);
    const key = keyFor(next.scope);
    if (
      !parseSiteRecovery(raw, next.scope) ||
      sessionStorage.getItem(key) !==
        (previous ? JSON.stringify(previous) : null)
    )
      return false;
    if (previous) {
      const terminal =
        previous.status === 'saved' || previous.status === 'discarded';
      if (
        terminal
          ? next.status !== 'editing' ||
            next.instance === previous.instance ||
            next.sequence !== 0
          : next.instance !== previous.instance ||
            next.sequence !== previous.sequence + 1
      )
        return false;
      if (
        previous.status === 'submitted' &&
        (resolved !== previous.command?.requestId ||
          !['editing', 'saved'].includes(next.status))
      )
        return false;
      if (
        next.status === 'saved' &&
        (previous.status !== 'submitted' ||
          resolved !== previous.command?.requestId)
      )
        return false;
    } else if (next.status !== 'editing' || next.sequence !== 0) return false;
    let count = previous ? 0 : 1;
    let total = bytes(raw);
    const reclaimable: { key: string; raw: string }[] = [];
    for (let index = 0; index < sessionStorage.length; index++) {
      const candidate = sessionStorage.key(index);
      if (!candidate?.startsWith(prefix)) continue;
      count++;
      if (candidate === key) continue;
      const stored = sessionStorage.getItem(candidate) ?? '';
      total += bytes(stored);
      const envelope = parseStoredEnvelope(stored);
      if (
        envelope &&
        keyFor(envelope.scope) === candidate &&
        ['saved', 'discarded'].includes(envelope.status)
      )
        reclaimable.push({ key: candidate, raw: stored });
    }
    const removals: typeof reclaimable = [];
    for (const candidate of reclaimable) {
      if (
        count <= creationRecoveryLimits.instances &&
        total <= creationRecoveryLimits.totalBytes
      )
        break;
      removals.push(candidate);
      count--;
      total -= bytes(candidate.raw);
    }
    if (
      count > creationRecoveryLimits.instances ||
      total > creationRecoveryLimits.totalBytes
    )
      return false;
    // Never reclaim unresolved or invalid data, and never revive a stale mount.
    if (
      sessionStorage.getItem(key) !==
      (previous ? JSON.stringify(previous) : null)
    )
      return false;
    for (const candidate of removals) {
      if (sessionStorage.getItem(candidate.key) !== candidate.raw) return false;
      sessionStorage.removeItem(candidate.key);
    }
    if (
      sessionStorage.getItem(key) !==
      (previous ? JSON.stringify(previous) : null)
    )
      return false;
    try {
      sessionStorage.setItem(key, raw);
      return sessionStorage.getItem(key) === raw;
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== 'QuotaExceededError'
      )
        return false;
    }
    // A browser's real quota may be smaller or shared with other feature data.
    // Reclaim only our verified terminal snapshots, one at a time as needed.
    for (const candidate of reclaimable.slice(removals.length)) {
      if (
        sessionStorage.getItem(key) !==
          (previous ? JSON.stringify(previous) : null) ||
        sessionStorage.getItem(candidate.key) !== candidate.raw
      )
        return false;
      sessionStorage.removeItem(candidate.key);
      try {
        sessionStorage.setItem(key, raw);
        return sessionStorage.getItem(key) === raw;
      } catch (error) {
        if (
          !(error instanceof DOMException) ||
          error.name !== 'QuotaExceededError'
        )
          return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}
export type SubmissionPersistence = {
  before: (command: {
    operation: string;
    requestId: string;
    expectedActorId?: string;
    payload: Record<string, unknown>;
  }) => boolean;
  after: (
    command: { requestId: string },
    result: CustodyState,
    unresolved: boolean,
  ) => boolean;
};
