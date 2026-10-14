'use client';

import {
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react';
import { PairedInventoryContent } from './paired-inventory-content';

import type { InventoryCaptureRegionId } from './inventory-capture-regions';

/** Explicit page capability. It never supplies readiness or discovers DOM. */
export const InventoryCaptureRegionsContext = createContext<{
  enabled: boolean;
  pairedInventory: boolean;
  conventionalPrimary: boolean;
} | null>(null);

/** One conventional DOM root only. Maps and their cold slots must be siblings. */
export function InventoryCaptureRegion({
  region,
  children,
}: {
  region: InventoryCaptureRegionId;
  children: ReactElement;
}) {
  const capability = useContext(InventoryCaptureRegionsContext);
  if (!capability) return children;
  return (
    <PairedInventoryContent
      enabled={capability?.enabled === true}
      conventionalPrimary={capability?.conventionalPrimary}
      pairedInventory={capability?.pairedInventory}
      region={region}
      wrap={false}
    >
      {children}
    </PairedInventoryContent>
  );
}

/** Group conventional siblings only on pages with the explicit region capability.
 * Ordinary form/list DOM stays unchanged. Region names never change this tree. */
export function InventoryCaptureGroup({
  region,
  className,
  children,
}: {
  region: InventoryCaptureRegionId;
  className?: string;
  children: ReactNode;
}) {
  const capability = useContext(InventoryCaptureRegionsContext);
  if (!capability) return children;
  return (
    <InventoryCaptureRegion region={region}>
      <div className={className}>{children}</div>
    </InventoryCaptureRegion>
  );
}
