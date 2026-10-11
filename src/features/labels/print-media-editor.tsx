'use client';
import { useState } from 'react';
import {
  defaultCustomLayout,
  layoutDraft,
  parseLayoutDraft,
  MAX_MEDIA_DRAFT_LENGTH,
  type LayoutDraft,
  type PrintLayout,
} from './print-layout';

const fieldNames: Record<string, string> = {
  labelWidth: 'Label width',
  labelHeight: 'Label height',
  sheetWidth: 'Sheet width',
  sheetHeight: 'Sheet height',
  marginTop: 'Top margin',
  marginRight: 'Right margin',
  marginBottom: 'Bottom margin',
  marginLeft: 'Left margin',
  gapX: 'Horizontal gap',
  gapY: 'Vertical gap',
};
export function PrintMediaEditor({
  layout,
  size,
  page,
  disabled = false,
  initialDraft,
  onChange,
}: {
  layout?: PrintLayout | null;
  size: '90x50' | '70x35';
  page: 'letter' | 'A4';
  disabled?: boolean;
  initialDraft?: LayoutDraft | null;
  onChange: (
    layout: PrintLayout | null,
    valid: boolean,
    draft: LayoutDraft | null,
  ) => void;
}) {
  const [draft, setDraft] = useState(
    () =>
      initialDraft ?? layoutDraft(layout ?? defaultCustomLayout(size, page)),
  );
  const [mode, setMode] = useState<'preset' | 'sheet' | 'single'>(
    (initialDraft?.mode as 'sheet' | 'single' | undefined) ??
      layout?.mode ??
      'preset',
  );
  const valid = mode === 'preset' || Boolean(parseLayoutDraft(draft));
  const update = (next: typeof draft) => {
    setDraft(next);
    const parsed = parseLayoutDraft(next);
    onChange(parsed, Boolean(parsed), next);
  };
  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-base font-semibold">Print media</legend>
      <label className="block text-sm">
        Output
        <select
          className="experience-field mt-1 block min-h-11 w-full px-3 text-base"
          value={mode}
          onChange={(event) => {
            const nextMode = event.target.value as typeof mode;
            setMode(nextMode);
            if (nextMode === 'preset') onChange(null, true, null);
            else update({ ...draft, mode: nextMode });
          }}
        >
          <option value="preset">Standard sheet</option>
          <option value="sheet">Custom sheet</option>
          <option value="single">One label per page</option>
        </select>
      </label>
      {mode !== 'preset' && (
        <div className="grid grid-cols-2 gap-3">
          {Object.entries(fieldNames)
            .filter(([field]) => mode === 'sheet' || field.startsWith('label'))
            .map(([field, name]) => (
              <label key={field} className="text-sm">
                {name} (mm)
                <input
                  className="experience-field mt-1 block min-h-11 w-full px-3 text-base"
                  type="text"
                  inputMode="decimal"
                  maxLength={MAX_MEDIA_DRAFT_LENGTH}
                  value={draft[field] ?? ''}
                  aria-invalid={!valid}
                  onChange={(event) =>
                    update({ ...draft, [field]: event.target.value })
                  }
                />
              </label>
            ))}
        </div>
      )}
      {!valid && (
        <p role="alert" className="text-sm">
          Enter complete dimensions in millimetres with at most one decimal
          place. Labels must be at least 38 × 32 mm and fit within the sheet
          margins. Maximum dimension: 500 mm; margin: 50 mm; gap: 25 mm.
        </p>
      )}
      <p className="text-sm">
        Custom media uses these dimensions instead of the standard label and
        paper sizes. Print at actual size / 100%, with browser headers and
        footers off. Your browser and printer determine supported paper sizes
        and printable margins. Check a paper sample with a ruler and scanner
        before using labels.
      </p>
    </fieldset>
  );
}
