import { ScanPanel } from '@/features/scan/scan-panel';
export default function ScanPage() {
  return (
    <>
      <p className="experience-eyebrow">Find / Labels</p>
      <h1 className="experience-heading mt-3">Scan and open</h1>
      <p className="experience-muted mb-7 mt-3 max-w-2xl text-sm leading-6">
        Scan an inventory label or enter a code to open a location, asset, or
        quantity item. Looking up a code does not change inventory.
      </p>
      <ScanPanel />
    </>
  );
}
