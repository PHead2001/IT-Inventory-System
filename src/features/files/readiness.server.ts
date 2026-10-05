import 'server-only';
import { fileKeys } from './keys.server';
import { fileRpc, type FileClient } from './rpc.server';

export class FileValidationUnavailableError extends Error {
  constructor() {
    super('File validation is not configured for this environment.');
  }
}

export async function fileSigningKey(client: FileClient) {
  const keyId = await fileRpc(client, 'inventory_file_active_key', {});
  const secret = typeof keyId === 'string' ? fileKeys()[keyId] : undefined;
  if (typeof keyId !== 'string' || !secret)
    throw new FileValidationUnavailableError();
  return { keyId, secret };
}
