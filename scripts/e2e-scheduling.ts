// Reviewed files use unique records/categories and browser-context storage.
// Files absent from this allowlist run exclusively, including future specs.
export const parallelSpecs = [
  'creation-recovery.spec.ts',
  'experience-completion.spec.ts',
  'experience-designer-acceptance.spec.ts',
  'experience-overhaul.spec.ts',
  'experience-recordings.spec.ts',
  'experience-visual.spec.ts',
  'field-authoring.spec.ts',
  'inventory.spec.ts',
  'labels-stock.spec.ts',
  'metadata.spec.ts',
  'navigation-performance.spec.ts',
  'navigation-workflow.spec.ts',
  'room.spec.ts',
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
