import 'server-only';
import { z } from 'zod';
import { fileKeys, proof } from './keys.server';
import { fileRpc, type FileClient } from './rpc.server';

const batchSize = 10;
const claimsSchema = z
  .array(z.object({ object_id: z.uuid(), path: z.string() }))
  .max(20);

export class FileCleanupNotConfiguredError extends Error {}

// Claims contain only database-selected terminal, unreferenced object paths.
// Storage DELETE and confirmation each recheck the caller's active authority.
export async function cleanupTerminalFiles(actor: {
  client: FileClient;
  userId: string;
}): Promise<{ deleted: number; pending: true }> {
  const keyId = z
    .string()
    .parse(await fileRpc(actor.client, 'inventory_file_active_key', {}));
  const secret = fileKeys()[keyId];
  if (!secret) throw new FileCleanupNotConfiguredError();
  const claims = claimsSchema.parse(
    await fileRpc(actor.client, 'inventory_file_cleanup_claim', {
      p_limit: batchSize,
      p_key_id: keyId,
      ...proof(secret, actor.userId, 'cleanup_claim', [
        String(batchSize),
        keyId,
      ]),
    }),
  );
  let deleted = 0;
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
      // A later bounded batch retries after this claim expires.
    }
  }
  return {
    deleted,
    // Claim results cannot prove completion. A newer terminal object may be
    // behind validation grace even after all older claims were confirmed.
    pending: true,
  };
}
