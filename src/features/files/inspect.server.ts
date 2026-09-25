import 'server-only';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export async function inspectFile(
  bytes: Uint8Array,
  type: string,
): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      join(process.cwd(), 'src/features/files/inspect-worker.cjs'),
      {
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
        },
      },
    );
    const timer = setTimeout(() => {
      void worker
        .terminate()
        .then(
          () =>
            reject(new Error('Inspection exceeded the 20 second time limit.')),
          reject,
        );
    }, 20000);
    worker.once(
      'message',
      (message: { ok: boolean; variants?: Uint8Array[]; message?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (!message.ok)
          reject(new Error(message.message ?? 'Inspection failed.'));
        else resolve(message.variants ?? []);
      },
    );
    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
    worker.postMessage({ bytes, type });
  });
}
