'use client';
import { useState, type FormEvent } from 'react';
import type { LocationRef } from '@/features/inventory/contracts-ui';
import { LocationPicker } from '@/features/locations/location-picker';
import { resolveScan } from '@/features/scan/resolve.server';
import { LabelSheet, type LabelRecord, type LabelSize } from './label-sheet';

export function LabelDesigner({
  locations,
  origin,
  preview,
  initial = [],
}: {
  locations: LocationRef[];
  origin: string;
  preview: boolean;
  initial?: LabelRecord[];
}) {
  const [records, setRecords] = useState<LabelRecord[]>(initial);
  const [locationCode, setLocationCode] = useState('');
  const [assetText, setAssetText] = useState('');
  const [size, setSize] = useState<LabelSize>('90x50');
  const [page, setPage] = useState<'A4' | 'letter'>('letter');
  const [format, setFormat] = useState<'qr' | 'code128'>('qr');
  const [message, setMessage] = useState('');
  const print = () => {
    const ready = document.querySelectorAll(
      '.label-print-root .label-card[data-code-ready="true"]',
    ).length;
    if (ready !== records.length) {
      setMessage('Wait for every code to appear before printing.');
      return;
    }
    window.print();
  };
  const add = (record: LabelRecord) =>
    setRecords((list) =>
      list.some((item) => item.kind === record.kind && item.key === record.key)
        ? list
        : [...list, record],
    );
  const addLocation = () => {
    const location = locations.find((item) => item.code === locationCode);
    if (!location) {
      setMessage('Select a location first.');
      return;
    }
    add({
      kind: 'location',
      key: location.code,
      name: location.name,
      context: location.breadcrumb,
      path: '/locations/' + location.code,
      state: location.active ? 'active' : 'inactive',
    });
    setMessage('Location added to print preview.');
  };
  const addAsset = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await resolveScan(assetText);
      const matches = result.matches.filter((match) => match.kind === 'asset');
      if (matches.length !== 1 || result.status !== 'found') {
        setMessage(
          'Enter an exact asset UUID, tag, or label. Ambiguous identifiers cannot be selected automatically.',
        );
        return;
      }
      const match = matches[0];
      const id = match.path.split('/').at(-1)!;
      // Obtain the current tag and name from the member-scoped server read.
      const record = await getAssetLabel(id);
      if (!record) {
        setMessage('Asset could not be found.');
        return;
      }
      add(record);
      setMessage('Asset added to print preview.');
    } catch {
      setMessage('Asset lookup could not be completed.');
    }
  };
  return (
    <>
      {preview && (
        <p className="mb-5 rounded border border-amber-600 p-3 font-semibold text-amber-200">
          Preview labels for {origin}. These are for this isolated environment
          only.
        </p>
      )}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-slate-700 p-4">
          <h2 className="font-semibold">Add a location</h2>
          <LocationPicker
            locations={locations}
            mode="browse"
            label="Choose a location or group"
            value={locationCode}
            onValueChange={setLocationCode}
          />
          <button
            type="button"
            onClick={addLocation}
            className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950"
          >
            Add location label
          </button>
        </div>
        <form
          onSubmit={(event) => void addAsset(event)}
          className="space-y-3 rounded-xl border border-slate-700 p-4"
        >
          <label htmlFor="asset-label-input" className="block font-semibold">
            Add a serialized asset
          </label>
          <input
            id="asset-label-input"
            value={assetText}
            onChange={(event) => setAssetText(event.target.value)}
            placeholder="Asset UUID, asset tag, or label"
            className="w-full rounded border border-slate-500 bg-slate-950 p-3"
          />
          <button className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950">
            Add asset label
          </button>
        </form>
      </section>
      {message && (
        <p role="status" className="mt-4 text-amber-200">
          {message}
        </p>
      )}
      <section className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold">Print preview</h2>
        <div className="flex flex-wrap gap-4 rounded-xl border border-slate-700 p-4">
          <label>
            Label size{' '}
            <select
              value={size}
              onChange={(event) => setSize(event.target.value as LabelSize)}
              className="ml-2 rounded bg-slate-800 p-2"
            >
              <option value="90x50">90 × 50 mm</option>
              <option value="70x35">70 × 35 mm</option>
            </select>
          </label>
          <label>
            Page{' '}
            <select
              value={page}
              onChange={(event) =>
                setPage(event.target.value as 'A4' | 'letter')
              }
              className="ml-2 rounded bg-slate-800 p-2"
            >
              <option value="letter">US Letter</option>
              <option value="A4">A4</option>
            </select>
          </label>
          <label>
            Code{' '}
            <select
              value={format}
              onChange={(event) =>
                setFormat(event.target.value as 'qr' | 'code128')
              }
              className="ml-2 rounded bg-slate-800 p-2"
            >
              <option value="qr">QR URL</option>
              <option value="code128">Code 128 when it fits</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-400">
          Default: 90 × 50 mm labels on US Letter, with QR codes. Use actual
          size / 100% in the browser print dialog. Code 128 asset tags must be
          reprinted if changed.
        </p>
        {records.length > 0 ? (
          <>
            <ul className="space-y-1">
              {records.map((record) => (
                <li
                  key={record.kind + record.key}
                  className="flex items-center gap-3"
                >
                  <span>
                    {record.name} ({record.key})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRecords((list) =>
                        list.filter((item) => item !== record),
                      )
                    }
                    className="text-cyan-300 underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={print}
              className="rounded bg-cyan-400 px-4 py-2 font-semibold text-slate-950"
            >
              Print selected labels / Save as PDF
            </button>
            <LabelSheet
              records={records}
              origin={origin}
              preview={preview}
              size={size}
              page={page}
              format={format}
            />
          </>
        ) : (
          <p>No labels selected yet.</p>
        )}
      </section>
    </>
  );
}

// Server action lives separately so client code never performs a privileged lookup.
import { getAssetLabel } from './queries.server';
