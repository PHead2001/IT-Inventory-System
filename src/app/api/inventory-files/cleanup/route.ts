import { NextResponse } from 'next/server';
import {
  cleanupTerminalFiles,
  FileCleanupNotConfiguredError,
} from '@/features/files/cleanup.server';
import { staffClient } from '@/features/files/rpc.server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const actor = await staffClient();
  if (!actor)
    return NextResponse.json({ message: 'Forbidden.' }, { status: 403 });
  try {
    return NextResponse.json(await cleanupTerminalFiles(actor));
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
