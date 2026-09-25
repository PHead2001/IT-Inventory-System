import 'server-only';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { InvalidFileContentError } from './inspection-error';

type InspectionMessage = {
  ok: boolean;
  code?: string;
  variants?: Uint8Array[];
  message?: string;
};

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
            reject(
              new InvalidFileContentError(
                'Inspection exceeded the 20 second time limit.',
              ),
            ),
          reject,
        );
    }, 20000);
    worker.once('message', (message: InspectionMessage) => {
      clearTimeout(timer);
      void worker.terminate();
      if (!message.ok)
        reject(
          message.code === 'INVALID_FILE_CONTENT'
            ? new InvalidFileContentError()
            : new Error('Inspection failed.'),
        );
      else resolve(message.variants ?? []);
    });
    worker.once('error', (error) => {
      clearTimeout(timer);
      void worker.terminate();
      reject(error);
    });
    worker.postMessage({ bytes, type });
  });
}
