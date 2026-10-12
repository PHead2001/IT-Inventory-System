import { createRoot } from 'react-dom/client';
import { LabelSheet } from '../../src/features/labels/label-sheet';
import type { JobSettings } from '../../src/features/labels/queue-model';

const root = createRoot(document.getElementById('fixture')!);
declare global {
  interface Window {
    renderPrintMedia: (job: JobSettings, count: number) => void;
  }
}
window.renderPrintMedia = (job, count) =>
  root.render(
    <div className="sheet-frame">
      <LabelSheet
        records={Array.from({ length: count }, (_, index) => ({
          kind: 'location',
          key: `ITC-D${String(index + 1).padStart(2, '0')}`,
          name: `Label ${index + 1}`,
          path: `/locations/ITC-D${String(index + 1).padStart(2, '0')}`,
        }))}
        origin="https://inventory.example.test"
        preview={false}
        {...job}
        generation={JSON.stringify([job, count])}
      />
    </div>,
  );
