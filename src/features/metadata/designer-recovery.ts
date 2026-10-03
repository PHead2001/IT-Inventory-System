import { z } from 'zod';
import {
  metadataDefinition,
  metadataField,
  type MetadataDefinition,
} from './contracts';

const PREFIX = 'it-inventory:form-designer:v1:';
const MAX_BYTES = 300_000;
// A dispatched command survives storage failures and component remounts in this
// page. Only a definitive result or explicit confirmed signout may remove it.
const unresolved = new Map<string, string>();
export function designerInstanceKey(
  memberId: string,
  environment: string,
): string {
  return `${memberId}:${environment}`;
}
export type DesignerRecovery = {
  memberId: string;
  categoryId: string;
  definition: MetadataDefinition;
  savedDefinition: string;
  expectedDraftId: string | null;
  expectedDraftVersion: string;
  expectedPublishedRevisionId: string;
  addition?: PendingFieldAddition;
  receipt?: { key: string; id: string };
  uncertainSave?: boolean;
  discardAfterCategoryId?: string;
};
export const pendingFieldAddition = z.object({
  sectionId: z.string(),
  field: metadataField.optional(),
  tab: z.enum(['new', 'existing', 'standard']).optional(),
  datetimeDraft: z
    .object({ wall: z.string().max(100), zone: z.string().max(100) })
    .optional(),
});
export type PendingFieldAddition = z.infer<typeof pendingFieldAddition>;

function key(memberId: string, categoryId: string) {
  const environment = `${window.location.origin}|${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}`;
  return `${PREFIX}${encodeURIComponent(environment)}:${memberId}:${categoryId}`;
}

export function readDesignerRecovery(
  memberId: string,
  categoryId: string,
): { available: boolean; item: DesignerRecovery | null } {
  const storageKey = key(memberId, categoryId);
  const pending = unresolved.get(storageKey);
  try {
    const stored = sessionStorage.getItem(storageKey);
    const raw = pending ?? stored;
    if (!raw) return { available: true, item: null };
    const candidate: unknown = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object')
      return { available: true, item: null };
    const entry = candidate as Partial<DesignerRecovery>;
    const definition = metadataDefinition.safeParse(entry.definition);
    const addition =
      entry.addition === undefined
        ? undefined
        : pendingFieldAddition.safeParse(entry.addition);
    const receipt =
      entry.receipt === undefined
        ? undefined
        : z.object({ key: z.string(), id: z.uuid() }).safeParse(entry.receipt);
    if (
      entry.memberId !== memberId ||
      entry.categoryId !== categoryId ||
      !definition.success ||
      (entry.discardAfterCategoryId !== undefined &&
        !z.uuid().safeParse(entry.discardAfterCategoryId).success) ||
      (entry.uncertainSave !== undefined &&
        typeof entry.uncertainSave !== 'boolean') ||
      (entry.uncertainSave === true && (!receipt || !receipt.success)) ||
      (addition && !addition.success) ||
      (receipt && !receipt.success) ||
      typeof entry.savedDefinition !== 'string' ||
      (entry.expectedDraftId !== null &&
        typeof entry.expectedDraftId !== 'string') ||
      typeof entry.expectedDraftVersion !== 'string' ||
      typeof entry.expectedPublishedRevisionId !== 'string'
    )
      return { available: true, item: null };
    if (entry.uncertainSave === true) unresolved.set(storageKey, raw);
    return {
      available: !pending || stored === pending,
      item: { ...entry, definition: definition.data } as DesignerRecovery,
    };
  } catch {
    return {
      available: false,
      item: pending ? (JSON.parse(pending) as DesignerRecovery) : null,
    };
  }
}

export function writeDesignerRecovery(item: DesignerRecovery): boolean {
  const storageKey = key(item.memberId, item.categoryId);
  const existing = readDesignerRecovery(item.memberId, item.categoryId);
  // Passive draft effects and redundant writes cannot revise an unresolved
  // command. Its receipt includes the exact payload, including review_token.
  const snapshot = existing.item?.uncertainSave ? existing.item : item;
  const raw = JSON.stringify(snapshot);
  if (snapshot.uncertainSave) unresolved.set(storageKey, raw);
  try {
    if (new TextEncoder().encode(raw).length > MAX_BYTES)
      throw new Error('Recovery exceeds the storage bound');
    sessionStorage.setItem(storageKey, raw);
    return true;
  } catch {
    if (snapshot.uncertainSave) {
      // A failed redundant write does not invalidate an already durable exact
      // command. If only memory remains, callers must not advertise safe reload.
      try {
        if (sessionStorage.getItem(storageKey) === raw) return true;
        sessionStorage.removeItem(storageKey);
      } catch {
        /* Keep the immutable in-memory command. */
      }
      return false;
    }
    // An older snapshot would be misleading after a newer write fails.
    // Removal is best effort when the browser also blocks storage access.
    clearDesignerRecovery(item.memberId, item.categoryId);
    return false;
  }
}

export function clearDesignerRecovery(
  memberId: string,
  categoryId: string,
): void {
  unresolved.delete(key(memberId, categoryId));
  try {
    sessionStorage.removeItem(key(memberId, categoryId));
  } catch {
    /* Storage may be disabled. */
  }
}

/** A successful authorized target designer mount completes an explicit discard switch. */
export function completeDesignerNavigation(
  memberId: string,
  categoryId: string,
): void {
  try {
    const prefix = key(memberId, '');
    const remove: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const candidate = sessionStorage.key(index);
      if (!candidate?.startsWith(prefix)) continue;
      const sourceCategoryId = candidate.slice(prefix.length);
      if (sourceCategoryId === categoryId) continue;
      const entry = readDesignerRecovery(memberId, sourceCategoryId).item;
      if (entry?.discardAfterCategoryId === categoryId && !entry.uncertainSave)
        remove.push(candidate);
    }
    for (const candidate of remove) sessionStorage.removeItem(candidate);
  } catch {
    /* Keep recovery when storage is unavailable. */
  }
}

/** Called by the protected-layout signout form; leaves other session data alone. */
export function clearAllDesignerRecovery(): void {
  unresolved.clear();
  try {
    const keys: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const candidate = sessionStorage.key(index);
      if (candidate?.startsWith(PREFIX)) keys.push(candidate);
    }
    for (const candidate of keys) sessionStorage.removeItem(candidate);
  } catch {
    /* Storage may be disabled. */
  }
}

/** Explicit signout may clear recovery only after acknowledging unknown saves. */
export function hasUnresolvedDesignerRecovery(): boolean {
  if (unresolved.size) return true;
  try {
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const candidate = sessionStorage.key(index);
      if (!candidate?.startsWith(PREFIX)) continue;
      const raw = sessionStorage.getItem(candidate);
      try {
        if (raw && JSON.parse(raw)?.uncertainSave === true) return true;
      } catch {
        // A malformed sibling entry must not conceal another unknown command.
      }
    }
  } catch {
    /* Storage may be disabled; in-memory commands were checked first. */
  }
  return false;
}
