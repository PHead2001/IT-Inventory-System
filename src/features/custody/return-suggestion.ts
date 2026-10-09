/** A version-bound suggestion from the current assignment episode, never recent-list history. */
export type AssetReturnSuggestion = {
  assetId: string;
  assetVersion: string;
  sourceEventId: string | null;
  locationId: string | null;
  status: 'suggested' | 'no_storage_origin' | 'ineligible' | 'unavailable';
};
