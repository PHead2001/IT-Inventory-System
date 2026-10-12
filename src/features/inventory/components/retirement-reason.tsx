'use client';
import { Button } from '@/components/ui/button';
import { field } from './read-ui';

export const retirementReasons = [
  'E-waste',
  'Lost',
  'Stolen',
  'RMA',
  'Sold',
  'Transferred',
] as const;
/** Compose once from separate editable fields; review and command share this text. */
export function retirementReason(reason: string, note: string) {
  const base = reason.trim();
  const detail = note.trim();
  return base ? [base, detail].filter(Boolean).join(' — ') : '';
}
export function RetirementReasonPresets({
  reason,
  onChange,
}: {
  reason: string;
  onChange: (reason: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm">Choose a retirement reason or enter your own.</p>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Retirement reason presets"
      >
        {retirementReasons.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant="outline"
            aria-pressed={reason === preset}
            onClick={() => onChange(preset)}
          >
            {preset}
          </Button>
        ))}
      </div>
    </div>
  );
}
export function RetirementNote({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (note: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id}>Retirement note (optional)</label>
      <textarea
        id={id}
        className={field}
        rows={2}
        maxLength={2000}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={id + '-help'}
      />
      <span id={id + '-help'} className="block text-sm text-slate-400">
        Added to your editable reason in the final review and history.
      </span>
    </div>
  );
}
