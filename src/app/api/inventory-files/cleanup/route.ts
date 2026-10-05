import { NextResponse } from 'next/server';
import {
  cleanupTerminalFiles,
  FileCleanupNotConfiguredError,
} from '@/features/files/cleanup.server';
import { staffClient } from '@/features/files/rpc.server';
import { fileParentSchema } from '@/features/files/contract';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const actor = await staffClient();
  if (!actor)
    return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
  const parent = fileParentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parent.success)
    return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
  try {
    return NextResponse.json(await cleanupTerminalFiles(actor, parent.data));
  } catch (error) {
    if (error instanceof FileCleanupNotConfiguredError)
      return NextResponse.json(
        { message: 'File cleanup is not configured.' },
        { status: 503 },
      );
    return NextResponse.json(
      { message: 'Cleanup could not be confirmed.' },
      { status: 409 },
    );
  }
}
