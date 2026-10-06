import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  fileParentSchema,
  fileRevisionSchema,
} from '@/features/files/contract';
import { proof } from '@/features/files/keys.server';
import {
  fileSigningKey,
  FileValidationUnavailableError,
} from '@/features/files/readiness.server';
import { fileRpc, fileError, staffClient } from '@/features/files/rpc.server';

export const runtime = 'nodejs';
const schema = fileParentSchema
  .extend({
    expectedRevision: fileRevisionSchema,
    name: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (name) => name.trim() === name && !/[\x00-\x1f\x7f/\\]/.test(name),
      ),
    type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    bytes: z.number().int().min(1).max(20971520),
    replaces: z
      .uuid()
      .transform((id) => id.toLowerCase())
      .nullable(),
    expectedFileVersion: fileRevisionSchema.nullable(),
  })
  .refine(
    (v) =>
      (v.replaces === null) === (v.expectedFileVersion === null) &&
      !(v.parentType === 'quantity' && v.type === 'application/pdf'),
  );

export async function POST(request: Request) {
  const actor = await staffClient();
  if (!actor)
    return NextResponse.json(
      { message: 'Only active staff can manage files.' },
      { status: 403 },
    );
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
  const v = input.data;
  try {
    // Authorize the parent before configuration lookup; do not create a reservation.
    await fileRpc(actor.client, 'inventory_file_cleanup_status', {
      p_parent_type: v.parentType,
      p_parent_id: v.parentId,
    });
    const { keyId, secret } = await fileSigningKey(actor.client);
    const result = await fileRpc(actor.client, 'inventory_file_reserve_ready', {
      p_parent_type: v.parentType,
      p_parent_id: v.parentId,
      p_expected_revision: v.expectedRevision,
      p_name: v.name,
      p_type: v.type,
      p_bytes: v.bytes,
      p_replaces: v.replaces,
      p_expected_file_version: v.expectedFileVersion,
      p_key_id: keyId,
      ...proof(secret, actor.userId, 'reserve', [
        v.parentType,
        v.parentId,
        v.expectedRevision,
        Buffer.from(v.name, 'utf8').toString('hex'),
        v.type,
        String(v.bytes),
        v.replaces ?? '-',
        v.expectedFileVersion ?? '-',
        keyId,
      ]),
    });
    return NextResponse.json({ result });
  } catch (error) {
    if (
      error instanceof FileValidationUnavailableError ||
      (error as { code?: string }).code === 'P1013'
    )
      return NextResponse.json(
        { message: 'File validation is not configured for this environment.' },
        { status: 503 },
      );
    return NextResponse.json({ message: fileError(error) }, { status: 409 });
  }
}
