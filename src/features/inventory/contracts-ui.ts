export type LocationRef = {
  id: string;
  code: string;
  name: string;
  breadcrumb: string;
  active: boolean;
  can_hold_inventory: boolean;
  parentId: string | null;
  sortOrder?: number;
};
export type CategoryRef = { id: string; name: string; active: boolean };
export type Metadata = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string;
  categoryName: string;
  manufacturer: string | null;
  model: string | null;
  version: number;
  customValues?: Record<
    string,
    { value: unknown; validated_revision_id: string }
  >;
  validatedFormRevisionId?: string | null;
  needsMetadata?: boolean;
  customDisplay?: Record<
    string,
    {
      value: unknown;
      validated_revision_id: string;
      label: string;
      field_type: string;
      option_paths: string[][];
      legacy: boolean;
    }
  >;
};
export type StockState =
  'disabled' | 'in_stock' | 'needs_restocking' | 'out_of_stock' | 'archived';
export type QuantityItem = Metadata & {
  archived: boolean;
  reorderThreshold: number | null;
};
export type AssetItem = Metadata & {
  status: 'active' | 'retired';
  assetTag: string | null;
  serialNumber: string | null;
};
export type InventoryResult = {
  kind: 'quantity' | 'asset';
  id: string;
  name: string;
  categoryName: string;
  status: string;
  location: LocationRef | null;
  site?: { id: string; code: string; name: string } | null;
  custodyKind?: 'storage' | 'site' | 'unlocated' | 'retired';
  quantity: number | null;
  assetTag: string | null;
  serialNumber: string | null;
  recordedTotal: number | null;
  availableQuantity?: string | null;
  assignedQuantity?: string | null;
  ownedQuantity?: string | null;
  reorderThreshold: number | null;
  stockState: StockState | null;
  customSummary?: string;
};
export type PageResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};
export type HistoryEvent = {
  id: string;
  kind: 'quantity' | 'asset';
  entityId: string;
  entityName: string;
  eventType: string;
  at: string;
  actorName: string;
  reason: string | null;
  lines: {
    location: LocationRef;
    delta: number;
    before: number;
    after: number;
  }[];
  fromLocation: LocationRef | null;
  toLocation: LocationRef | null;
  metadataChanges: {
    field: string;
    before: string | null;
    after: string | null;
  }[];
  customMetadataPresent: boolean;
  customMetadataChanged: boolean;
};
export type DuplicateSerial = {
  id: string;
  name: string;
  assetTag: string | null;
  status: string;
};
export type QuantityDetail = {
  item: QuantityItem;
  stockSummary: {
    availableQuantity: string;
    assignedQuantity: string;
    ownedQuantity: string;
    reorderThreshold: number | null;
    stockState: StockState;
  };
  balances: { location: LocationRef; quantity: number }[];
  history: HistoryEvent[];
};
export type AssetDetail = {
  asset: AssetItem;
  location: LocationRef | null;
  site: { id: string; code: string; name: string } | null;
  history: HistoryEvent[];
  duplicateSerialMatches: DuplicateSerial[];
};
