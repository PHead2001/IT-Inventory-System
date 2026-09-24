import { ScanPanel } from '@/features/scan/scan-panel';
export default function ScanPage() {
  return (
    <>
      <h1 className="mb-2 text-3xl font-semibold">Scan and open</h1>
      <p className="mb-6 text-slate-400">
        Scan a label or enter its text to find a location or asset.
      </p>
      <ScanPanel />
    </>
  );
}
