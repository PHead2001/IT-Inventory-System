import { z } from 'zod';
import type { ScanMatch } from './resolve.server';
import type { CustodyState } from '@/features/custody/contracts';

export const assignmentContextSchema = z.strictObject({
  siteId: z.uuid(),
  siteName: z.string().max(200),
  reference: z.string().max(200),
  sourceId: z.union([z.uuid(), z.literal('')]),
});
export type AssignmentContext = z.infer<typeof assignmentContextSchema>;
export const assignmentCandidateSchema = z.strictObject({
  kind: z.enum(['quantity', 'asset']),
  id: z.uuid(),
  path: z.string().max(256),
  name: z.string().max(200),
  identifier: z.string().max(200).nullable(),
  version: z.string().regex(/^[1-9]\d*$/),
  status: z.enum(['active', 'archived', 'retired']),
  currentSite: z.string().max(200).nullable(),
  sources: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z.string().max(500),
        active: z.boolean(),
        quantity: z.number().int().positive().max(2147483647),
      }),
    )
    .max(10000),
});
export type AssignmentCandidate = z.infer<typeof assignmentCandidateSchema>;
export type AssignmentInspection =
  { ok: true; candidate: AssignmentCandidate } | { ok: false; message: string };
export type AssignmentLookup =
  | {
      ok: true;
      matches: ScanMatch[];
      status: 'found' | 'ambiguous' | 'unknown' | 'invalid';
      searchPage?: AssignmentSearchPage;
    }
  | { ok: false; message: string };
export type AssignmentSearchPage = {
  query: string;
  page: number;
  pageSize: number;
  total: number;
};
export type AssignmentCommand = {
  operation: 'quantity_site_change' | 'asset_site_change';
  requestId: string;
  expectedActorId: string;
  payload: Record<string, unknown>;
};
export type AssignmentSuccess = Extract<CustodyState, { ok: true }>;

export function selectedAssignmentSource(
  candidate: AssignmentCandidate,
  explicit: string,
) {
  return (
    candidate.sources.find((row) => row.id === explicit) ??
    (candidate.sources.length === 1 ? candidate.sources[0] : null)
  );
}
export function assignmentProblem(
  candidate: AssignmentCandidate,
  sourceId: string,
  units: string,
) {
  if (candidate.status !== 'active')
    return `This record is ${candidate.status}. Open its details to review its lifecycle.`;
  if (candidate.currentSite)
    return `This asset is already assigned to ${candidate.currentSite}. Use its custody workflow for an explicit return or transfer.`;
  if (!candidate.sources.length)
    return 'No available storage stock remains. Receive or return stock through its inventory record before assigning.';
  const source = candidate.sources.find((row) => row.id === sourceId);
  if (!source)
    return 'Choose a recorded storage source. Multiple holdings require an explicit choice.';
  if (
    candidate.kind === 'quantity' &&
    (!/^[1-9]\d*$/.test(units) ||
      !Number.isSafeInteger(Number(units)) ||
      Number(units) > source.quantity)
  )
    return `Enter a whole-unit quantity from 1 to ${source.quantity}.`;
  return null;
}
export function assignmentCommand(
  candidate: AssignmentCandidate,
  context: AssignmentContext,
  sourceId: string,
  units: string,
  actorId: string,
  requestId: string,
): AssignmentCommand {
  const problem = assignmentProblem(candidate, sourceId, units);
  if (problem) throw new Error(problem);
  return {
    operation:
      candidate.kind === 'quantity'
        ? 'quantity_site_change'
        : 'asset_site_change',
    requestId,
    expectedActorId: actorId,
    payload: {
      action: candidate.kind === 'quantity' ? 'issue' : 'assign',
      [candidate.kind === 'quantity' ? 'item_id' : 'asset_id']: candidate.id,
      expected_version: candidate.version,
      source_location_id: sourceId,
      destination_site_id: context.siteId,
      reason: null,
      reference: context.reference.trim() || null,
      ...(candidate.kind === 'quantity' ? { quantity: Number(units) } : {}),
    },
  };
}
