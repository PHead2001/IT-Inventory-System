import { NextResponse } from 'next/server';
import { z } from 'zod';
import { fileRpc, staffClient } from '@/features/files/rpc.server';
import { fileKeys, proof } from '@/features/files/keys.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const actor = await staffClient();
  if (!actor)
    return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
  try {
    const keyId = z
      .string()
      .parse(await fileRpc(actor.client, 'inventory_file_active_key', {}));
    const secret = fileKeys()[keyId];
    if (!secret)
      return NextResponse.json(
        { message: 'File cleanup is not configured.' },
        { status: 503 },
      );
    const claims = z
      .array(z.object({ object_id: z.uuid(), path: z.string() }))
      .parse(
        await fileRpc(actor.client, 'inventory_file_cleanup_claim', {
          p_limit: 10,
          p_key_id: keyId,
          ...proof(secret, actor.userId, 'cleanup_claim', ['10', keyId]),
        }),
      );
    let deleted = 0;
    for (const claim of claims) {
      // The Storage API removes provider bytes and metadata. Confirmation
      // retains the tombstone and only marks it deleted after absence.
      await actor.client.storage.from('inventory-files').remove([claim.path]);
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
        /* A later bounded batch retries after the claim expires. */
      }
    }
    return NextResponse.json({ deleted });
  } catch {
    return NextResponse.json(
      { message: 'Cleanup could not be confirmed.' },
      { status: 409 },
    );
  }
}
