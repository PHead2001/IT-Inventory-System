// Reviewed mutable workflows target owned records/categories and browser-context storage.
// Immutable seeded reference reads are safe only while no parallel spec mutates them.
// Files absent from this allowlist run exclusively, including future specs.
// experience-visual reads the first global inventory/category/site records: it must
// finish before another spec can archive, retire, rename, or remove its selection.
// The pinned Playwright collector sorts files lexically and dispatches file groups
// in that order. Start the long room journey first to avoid a lone late worker;
// file-level sequencing and the existing two-worker ceiling remain unchanged.
export const parallelSpecs = [
  '00-room.spec.ts',
  'creation-recovery.spec.ts',
  'experience-completion.spec.ts',
  'experience-designer-acceptance.spec.ts',
  'experience-overhaul.spec.ts',
  'experience-recordings.spec.ts',
  'field-authoring.spec.ts',
  'inventory.spec.ts',
  'labels-stock.spec.ts',
  'metadata.spec.ts',
  'navigation-performance.spec.ts',
  'navigation-workflow.spec.ts',
  'scope-accessibility-forms.spec.ts',
  'scope-accessibility.spec.ts',
  'telemetry.spec.ts',
] as const;

type Scheduling = {
  workers: number;
  projects: {
    name: string;
    workers?: number;
    testMatch?: string[];
    testIgnore?: string[];
    dependencies?: string[];
  }[];
};

export function e2eScheduling(fullSuite: boolean): Scheduling {
  if (!fullSuite) return { workers: 1, projects: [{ name: 'chromium' }] };
  const patterns = parallelSpecs.map((file) => '**/' + file);
  return {
    workers: 2,
    projects: [
      {
        name: 'chromium-exclusive',
        workers: 1,
        testIgnore: patterns,
      },
      {
        name: 'chromium-parallel',
        workers: 2,
        testMatch: patterns,
        dependencies: ['chromium-exclusive'],
      },
    ],
  };
}
