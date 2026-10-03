import { z } from 'zod';
import {
  metadataDefinition,
  metadataField,
  type MetadataDefinition,
} from './contracts';

const PREFIX = 'it-inventory:form-designer:v1:';
const MAX_BYTES = 300_000;
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
  try {
    const raw = sessionStorage.getItem(key(memberId, categoryId));
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
    return {
      available: true,
      item: { ...entry, definition: definition.data } as DesignerRecovery,
    };
  } catch {
    return { available: false, item: null };
  }
}

export function writeDesignerRecovery(item: DesignerRecovery): boolean {
  try {
    const raw = JSON.stringify(item);
    if (new TextEncoder().encode(raw).length > MAX_BYTES) {
      clearDesignerRecovery(item.memberId, item.categoryId);
      return false;
    }
    sessionStorage.setItem(key(item.memberId, item.categoryId), raw);
    return true;
  } catch {
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
