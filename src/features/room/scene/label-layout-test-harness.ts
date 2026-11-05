import {
  layoutLabels as productionLayoutLabels,
  layoutLabelsDetailed as productionLayoutLabelsDetailed,
} from './label-layout';

export { LABEL_PACKING_BUDGET } from './label-layout';
export type { LabelArea, LabelPlacement, LabelRect } from './label-layout';

// Static geometry tests keep every work limit while isolating OS scheduling.
// Timing tests retain their explicitly supplied clock and production watchdog.
export const layoutLabelsDetailed: typeof productionLayoutLabelsDetailed = (
  labels,
  viewport,
  reserved,
  limits,
  clock = () => 0,
) => productionLayoutLabelsDetailed(labels, viewport, reserved, limits, clock);

export const layoutLabels: typeof productionLayoutLabels = (
  labels,
  viewport,
  reserved,
) => layoutLabelsDetailed(labels, viewport, reserved).placements;
