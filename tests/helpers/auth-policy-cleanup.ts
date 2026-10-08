/** Attempt every owned Auth deletion and retain the original policy-test failure. */
export async function withAuthPolicyCleanup(
  ids: string[],
  remove: (id: string) => Promise<{ error: unknown }>,
  run: () => Promise<void>,
) {
  let failed = false;
  let originalFailure: unknown;
  try {
    await run();
  } catch (error) {
    failed = true;
    originalFailure = error;
  }
  const cleanupErrors: Error[] = [];
  for (const [index, id] of ids.entries()) {
    try {
      if ((await remove(id)).error) throw new Error('Removal failed');
    } catch {
      // Provider errors may contain credentials or account identity. Retain only
      // the owned position, never the raw error or identifier, in diagnostics.
      cleanupErrors.push(
        new Error(
          `Disposable Auth cleanup failed (owned account ${index + 1})`,
        ),
      );
    }
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      failed ? [originalFailure, ...cleanupErrors] : cleanupErrors,
      'Disposable Auth account cleanup failed',
    );
  if (failed) throw originalFailure;
}
