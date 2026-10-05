import 'server-only';
import { z } from 'zod';
import { fileKeys, proof } from './keys.server';
import { fileRpc, type FileClient } from './rpc.server';
import type { CleanupResult, FileParent } from './contract';

const batchSize = 10;
const claimsSchema = z
  .array(z.object({ object_id: z.uuid(), path: z.string() }))
  .max(20);

export class FileCleanupNotConfiguredError extends Error {}

// Claims contain only database-selected terminal, unreferenced object paths.
// Storage DELETE and confirmation each recheck the caller's active authority.
export async function cleanupTerminalFiles(
  actor: {
    client: FileClient;
    userId: string;
  },
  parent: FileParent,
): Promise<CleanupResult> {
  const parentArgs = {
    p_parent_type: parent.parentType,
    p_parent_id: parent.parentId,
  };
  const statusSchema = z
    .strictObject({
      outstanding: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      blocked: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .refine((value) => value.blocked <= value.outstanding);
  const status = async () =>
    statusSchema.parse(
      await fileRpc(actor.client, 'inventory_file_cleanup_status', parentArgs),
    );
  // This authorized, complete work set includes held/grace objects and permanent
  // tombstones. Empty visible cards or an empty claim batch are never proof.
  const before = await status();
  if (before.outstanding === 0)
    return {
      deleted: 0,
      failed: 0,
      ...before,
      pending: false,
      status: 'no_work',
    };
  const keyId = z
    .string()
    .nullable()
    .parse(await fileRpc(actor.client, 'inventory_file_active_key', {}));
  const secret = keyId ? fileKeys()[keyId] : undefined;
  if (!keyId || !secret) throw new FileCleanupNotConfiguredError();
  const claims = claimsSchema.parse(
    await fileRpc(actor.client, 'inventory_file_cleanup_claim_parent', {
      ...parentArgs,
      p_limit: batchSize,
      p_key_id: keyId,
      ...proof(secret, actor.userId, 'cleanup_claim', [
        parent.parentType,
        parent.parentId,
        String(batchSize),
        keyId,
      ]),
    }),
  );
  let deleted = 0;
  let failed = 0;
  for (const claim of claims) {
    // A failed/ambiguous provider DELETE remains retryable. The confirmation
    // RPC verifies absence before it records a permanent tombstone.
    await actor.client.storage
      .from('inventory-files')
      .remove([claim.path])
      .catch(() => null);
    try {
      await fileRpc(actor.client, 'inventory_file_cleanup_confirm', {
        p_object_id: claim.object_id,
        p_key_id: keyId,
        ...proof(secret, actor.userId, 'cleanup_confirm', [
          claim.object_id,
          keyId,
        ]),
      });
      deleted++;
    } catch {
      failed++;
      // A later bounded batch retries after this claim expires.
    }
  }
  const after = await status();
  // A confirmation can commit while its response is lost. Only this fresh,
  // authorized complete work-set read can settle that ambiguity; acknowledged
  // deletions remain the count for this request, including concurrent cleanup.
  if (after.outstanding === 0)
    return { deleted, failed: 0, ...after, pending: false, status: 'complete' };
  return {
    deleted,
    failed,
    ...after,
    pending: after.outstanding > 0 || failed > 0,
    status:
      failed > 0
        ? deleted > 0
          ? 'partial'
          : 'failed'
        : after.outstanding > 0
          ? 'pending'
          : 'complete',
  };
}
