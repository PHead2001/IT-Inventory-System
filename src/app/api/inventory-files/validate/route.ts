import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { inspectFile } from '@/features/files/inspect.server';
import { InvalidFileContentError } from '@/features/files/inspection-error';
import { cleanupTerminalFiles } from '@/features/files/cleanup.server';
import { fileError, fileRpc, staffClient } from '@/features/files/rpc.server';
import { fileKeys, mac, proof } from '@/features/files/keys.server';
import {
  fileSigningKey,
  FileValidationUnavailableError,
} from '@/features/files/readiness.server';
import type { CleanupResult, FileParent } from '@/features/files/contract';

export const runtime = 'nodejs';
export const maxDuration = 60;
const bucket = 'inventory-files';
const revision = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n);
const requestSchema = z.strictObject({
  fileId: z.uuid(),
  requestId: z.uuid(),
  expectedRevision: revision,
  expectedFileVersion: revision.nullable(),
});
const beginSchema = z.object({
  generation: z.number().int().positive(),
  key_id: z.string(),
  lease_until: z.number(),
  source_path: z.string(),
  source_id: z.uuid(),
  source_version: z.string(),
});
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

export async function POST(request: Request) {
  const actor = await staffClient();
  if (!actor)
    return NextResponse.json(
      { message: 'Only active staff can manage files.' },
      { status: 403 },
    );
  const input = requestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
  const { client, userId } = actor;
  // Receipt replay is authorization checked by the RPC and deliberately does
  // not depend on a current signing key or unexpired validation lease.
  try {
    const replay = await fileRpc(client, 'inventory_file_finalize', {
      p_file_id: input.data.fileId,
      p_expected_revision: input.data.expectedRevision,
      p_request_id: input.data.requestId,
    });
    return NextResponse.json({ result: replay });
  } catch (error) {
    if ((error as { code?: string }).code === 'P1009')
      return NextResponse.json({ message: fileError(error) }, { status: 409 });
  }
  const keys = fileKeys();
  if (Object.keys(keys).length === 0)
    return NextResponse.json(
      { message: 'File validation is not configured for this environment.' },
      { status: 503 },
    );
  const storage = client.storage.from(bucket);
  let generation: number | null = null;
  let validationKey: string | null = null;
  let parent: FileParent | null = null;
  try {
    // A pending validated file reaches here only after an explicit review
    // against the currently visible collection and replacement file versions.
    await fileRpc(client, 'inventory_file_review', {
      p_file_id: input.data.fileId,
      p_expected_revision: input.data.expectedRevision,
      p_expected_file_version: input.data.expectedFileVersion,
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code !== 'P1008') throw error;
    });
    const { keyId: activeKey, secret: activeSecret } =
      await fileSigningKey(client);
    const begin = beginSchema.parse(
      await fileRpc(client, 'inventory_file_begin', {
        p_file_id: input.data.fileId,
        p_request_id: input.data.requestId,
        p_key_id: activeKey,
        ...proof(activeSecret, userId, 'begin', [
          input.data.fileId,
          input.data.requestId,
          activeKey,
        ]),
      }),
    );
    generation = begin.generation;
    const keyId = begin.key_id;
    validationKey = keyId;
    const secret = keys[keyId];
    if (!secret)
      throw new Error(
        'File validation is not configured for this environment.',
      );
    const sourceInfo = await storage.info(begin.source_path);
    if (
      sourceInfo.error ||
      sourceInfo.data.id !== begin.source_id ||
      sourceInfo.data.version !== begin.source_version
    )
      throw new Error('Source generation changed.');
    const { data: sourceBlob, error: sourceError } = await storage.download(
      begin.source_path,
    );
    if (sourceError || !sourceBlob || sourceBlob.size > 20971520)
      throw new Error('Source could not be inspected.');
    const bytes = new Uint8Array(await sourceBlob.arrayBuffer());
    const fileDigest = sha(bytes);
    const details = z
      .object({
        type: z.enum([
          'image/jpeg',
          'image/png',
          'image/webp',
          'application/pdf',
        ]),
        bytes: z.number().int(),
        parent_type: z.enum(['asset', 'quantity']),
        parent_id: z.uuid(),
        reviewed_revision: revision,
        purpose: z.enum(['asset_photo', 'asset_document', 'recognition_photo']),
        replaces: z.uuid().nullable(),
        replaced_file_version: revision.nullable(),
      })
      .parse(
        await fileRpc(client, 'inventory_file_source_details', {
          p_file_id: input.data.fileId,
        }),
      );
    if (bytes.length !== details.bytes)
      throw new Error('Source length changed.');
    parent = { parentType: details.parent_type, parentId: details.parent_id };
    const variants = await inspectFile(bytes, details.type);
    const registered: string[] = [];
    if (variants.length) {
      for (const [index, variant] of variants.entries()) {
        const kind = index === 0 ? 'display' : 'thumbnail';
        const nonce = randomBytes(16).toString('hex');
        const expiry = Math.min(
          begin.lease_until,
          Math.floor(Date.now() / 1000) + 240,
        );
        const signed = `${userId}:${input.data.fileId}:${generation}:${kind}:${nonce}:${expiry}`;
        const path = `d/${keyId}/${input.data.fileId}/${generation}/${kind}/${nonce}/${expiry}/${mac(secret, signed)}`;
        const variantDigest = sha(variant);
        await fileRpc(client, 'inventory_file_prepare_variant', {
          p_file_id: input.data.fileId,
          p_generation: generation,
          p_variant: kind,
          p_path: path,
          p_bytes: variant.length,
          p_sha256: variantDigest,
          p_mac: mac(
            secret,
            `${userId}:${input.data.fileId}:${generation}:${kind}:${path}:${variant.length}:${variantDigest}`,
          ),
        });
        const upload = await storage.upload(path, variant, {
          contentType: 'image/jpeg',
          upsert: false,
        });
        if (upload.error) throw new Error('Derived upload failed.');
        const registration = z
          .object({ id: z.uuid(), version: z.string() })
          .parse(
            await fileRpc(client, 'inventory_file_register', {
              p_file_id: input.data.fileId,
              p_generation: generation,
              p_variant: kind,
              p_path: path,
              p_object_id: upload.data.id,
              p_bytes: variant.length,
              p_sha256: variantDigest,
              p_mac: mac(
                secret,
                `${userId}:${input.data.fileId}:${generation}:${kind}:${path}:${upload.data.id}:${variant.length}:${variantDigest}`,
              ),
            }),
          );
        registered.push(
          `${kind}:${registration.id}:${registration.version}:${variant.length}:${variantDigest}`,
        );
      }
    }
    const signed = [
      'v2',
      userId,
      input.data.fileId,
      generation,
      details.parent_type,
      details.parent_id,
      details.reviewed_revision,
      input.data.requestId,
      begin.lease_until,
      keyId,
      details.purpose,
      details.replaces ?? '-',
      details.replaced_file_version ?? '-',
      begin.source_id,
      begin.source_version,
      details.type,
      bytes.length,
      fileDigest,
      registered.sort().join('|'),
    ].join(':');
    await fileRpc(client, 'inventory_file_validated', {
      p_file_id: input.data.fileId,
      p_generation: generation,
      p_key_id: keyId,
      p_source_id: begin.source_id,
      p_source_version: begin.source_version,
      p_type: details.type,
      p_bytes: bytes.length,
      p_sha256: fileDigest,
      p_mac: mac(secret, signed),
    });
    const result = await fileRpc(client, 'inventory_file_finalize', {
      p_file_id: input.data.fileId,
      p_expected_revision: input.data.expectedRevision,
      p_request_id: input.data.requestId,
    });
    revalidatePath('/inventory', 'layout');
    revalidatePath('/history');
    return NextResponse.json({ result });
  } catch (error) {
    // Only a trusted worker's typed content rejection is terminal. Storage,
    // download, RPC and stale-version failures retain their retryable state.
    if (
      generation !== null &&
      validationKey !== null &&
      keys[validationKey] &&
      error instanceof InvalidFileContentError
    ) {
      try {
        await fileRpc(client, 'inventory_file_reject', {
          p_file_id: input.data.fileId,
          p_generation: generation,
          p_key_id: validationKey,
          ...proof(keys[validationKey], userId, 'reject', [
            input.data.fileId,
            String(generation),
            validationKey,
          ]),
        });
      } catch {
        return NextResponse.json(
          {
            message:
              'The invalid file could not be rejected. Refresh and retry the pending file.',
          },
          { status: 409 },
        );
      }
      let cleanupResult: CleanupResult | null = null;
      try {
        if (parent) cleanupResult = await cleanupTerminalFiles(actor, parent);
      } catch {
        // The file remains rejected. A later bounded cleanup request retries.
      }
      return NextResponse.json(
        {
          message: fileError(error),
          terminalRejected: true,
          // The new terminal source may still be behind validation grace.
          // Claims alone cannot certify that every byte has been removed.
          cleanupPending: cleanupResult?.pending ?? true,
          cleanupDeleted: cleanupResult?.deleted ?? null,
          cleanup: cleanupResult,
        },
        { status: 409 },
      );
    }
    if (error instanceof FileValidationUnavailableError)
      return NextResponse.json({ message: error.message }, { status: 503 });
    return NextResponse.json({ message: fileError(error) }, { status: 409 });
  }
}
