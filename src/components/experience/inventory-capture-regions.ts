// Closed capability inventory: fewer than 64 participants before capture.
export const inventoryCaptureRegionIds = [
  'header',
  'body',
  'record-supporting-content',
  'preview-controls',
  'preview-location',
  'preview-link',
  'task-launcher',
  'task-heading',
  'task-close',
  'task-metadata',
  'task-archive',
  'mutation-intro',
  'mutation-metadata',
  'mutation-receive',
  'mutation-move',
  'mutation-adjust',
  'mutation-reason',
  'mutation-completion',
  'custody-intro',
  'custody-opening-help',
  'custody-location-help',
  'custody-inputs',
  'custody-completion',
  'picker-source',
  'picker-destination',
  'picker-browser-source',
  'picker-browser-destination',
] as const;
export type InventoryCaptureRegionId =
  (typeof inventoryCaptureRegionIds)[number];

export function isInventoryCaptureName(name: string, base: string) {
  return (
    name === base ||
    inventoryCaptureRegionIds.some(
      (region) => region !== 'body' && name === base + '-' + region,
    )
  );
}
