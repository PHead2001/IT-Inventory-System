import { z } from 'zod';
import { parseCustodyCommand } from '@/features/custody/contracts';
import {
  assignmentCandidateSchema,
  assignmentContextSchema,
  assignmentProblem,
  type AssignmentCommand,
} from './assign-contracts';
const scopeSchema = z.strictObject({
  actor: z.uuid(),
  origin: z.url(),
  backend: z.url(),
});
export type AssignmentScope = z.infer<typeof scopeSchema>;
const schema = z
  .strictObject({
    version: z.literal(1),
    scope: scopeSchema,
    context: assignmentContextSchema,
    candidate: assignmentCandidateSchema,
    sourceId: z.uuid(),
    units: z.string().max(20),
    command: z.strictObject({
      operation: z.enum(['quantity_site_change', 'asset_site_change']),
      requestId: z.uuid(),
      expectedActorId: z.uuid(),
      payload: z.record(z.string(), z.unknown()),
    }),
  })
  .superRefine((value, ctx) => {
    const { command, candidate, context, sourceId } = value;
    if (
      !parseCustodyCommand(command).success ||
      command.expectedActorId !== value.scope.actor ||
      command.operation !== `${candidate.kind}_site_change` ||
      command.payload[
        candidate.kind === 'quantity' ? 'item_id' : 'asset_id'
      ] !== candidate.id ||
      command.payload.expected_version !== candidate.version ||
      command.payload.destination_site_id !== context.siteId ||
      command.payload.source_location_id !== sourceId ||
      command.payload.action !==
        (candidate.kind === 'quantity' ? 'issue' : 'assign') ||
      command.payload.reference !== (context.reference.trim() || null) ||
      command.payload.reason !== null ||
      candidate.path !==
        `/inventory/${candidate.kind === 'quantity' ? 'quantity' : 'assets'}/${candidate.id}` ||
      assignmentProblem(candidate, sourceId, value.units) !== null ||
      (candidate.kind === 'asset' && value.units !== '1') ||
      (candidate.kind === 'quantity' &&
        command.payload.quantity !== Number(value.units))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Inconsistent assignment recovery identity.',
      });
  });
export type AssignmentRecovery = z.infer<typeof schema> & {
  command: AssignmentCommand;
};
const key = (scope: AssignmentScope) =>
  'inventory-assign-v1:' +
  JSON.stringify([scope.origin, scope.backend, scope.actor]);
export function parseAssignmentRecovery(
  raw: string,
  scope: AssignmentScope,
): AssignmentRecovery | null {
  if (new TextEncoder().encode(raw).length > 262144) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success &&
      Object.keys(scope).every(
        (name) =>
          result.data.scope[name as keyof AssignmentScope] ===
          scope[name as keyof AssignmentScope],
      )
      ? result.data
      : null;
  } catch {
    return null;
  }
}
export function readAssignmentRecovery(scope: AssignmentScope) {
  try {
    const raw = sessionStorage.getItem(key(scope));
    return {
      value: raw ? parseAssignmentRecovery(raw, scope) : null,
      blocked: !!raw && !parseAssignmentRecovery(raw, scope),
    };
  } catch {
    return { value: null, blocked: true };
  }
}
export function storeAssignmentRecovery(
  value: AssignmentRecovery,
  previous: AssignmentRecovery | null,
) {
  try {
    const raw = JSON.stringify(value);
    if (
      !parseAssignmentRecovery(raw, value.scope) ||
      sessionStorage.getItem(key(value.scope)) !==
        (previous ? JSON.stringify(previous) : null)
    )
      return false;
    sessionStorage.setItem(key(value.scope), raw);
    return sessionStorage.getItem(key(value.scope)) === raw;
  } catch {
    return false;
  }
}
export function clearAssignmentRecovery(
  scope: AssignmentScope,
  requestId: string,
) {
  try {
    const raw = sessionStorage.getItem(key(scope));
    const previous = raw ? parseAssignmentRecovery(raw, scope) : null;
    if (!previous || previous.command.requestId !== requestId) return false;
    sessionStorage.removeItem(key(scope));
    return !sessionStorage.getItem(key(scope));
  } catch {
    return false;
  }
}
