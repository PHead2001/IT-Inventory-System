/** Attempt every owned cleanup, retaining all failures rather than masking later work. */
export async function cleanupInterfaceFixture(steps: {
  record: () => Promise<void>;
  category: () => Promise<void>;
  signOut: () => Promise<void>;
}) {
  const errors: unknown[] = [];
  for (const cleanup of [steps.record, steps.category, steps.signOut]) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Owned interface fixture cleanup failed');
}
