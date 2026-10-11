import { custodyEventLabel } from '../../src/features/custody/vocabulary';
export function custodyButtons(title: string) {
  const labels: Record<string, [string, string]> = {
    'Issue stock to a site': ['Review issue', 'Issue to site'],
    'Assign asset to a site': ['Review assignment', 'Assign to site'],
    'Return to storage': ['Review return', 'Return to storage'],
    'Transfer between sites': ['Review transfer', 'Transfer between sites'],
    'Record existing site holding': [
      'Review site holding',
      'Record site holding',
    ],
    'Correct recorded site holding': ['Review correction', 'Save correction'],
    'Correct recorded site custody': ['Review correction', 'Save correction'],
    'Write off at site': ['Review write-off', 'Write off at site'],
    'Retire asset at site': ['Review retirement', 'Retire asset at site'],
  };
  return (
    labels[title] ?? [
      `Review ${title.toLowerCase()}`,
      `Confirm ${title.toLowerCase()}`,
    ]
  );
}

/** Assert the committed operation, never a generic success or another task's receipt. */
export function custodyReceiptTitle(title: string, kind: 'quantity' | 'asset') {
  const operations: Record<string, string> = {
    'Issue stock to a site': 'issued',
    'Assign asset to a site': 'assigned',
    'Return to storage': 'returned',
    'Transfer between sites': 'transferred',
    'Record existing site holding': 'opened',
    'Correct recorded site holding': 'corrected',
    'Correct recorded site custody': 'corrected',
    'Write off at site': 'written_off',
    'Retire asset at site': 'retired',
  };
  const operation = operations[title];
  if (!operation) throw new Error(`Unsupported custody task: ${title}`);
  return custodyEventLabel(operation, kind);
}
