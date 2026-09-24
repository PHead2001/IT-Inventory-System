import type { Metadata } from '@/features/inventory/contracts-ui';
import { formatCustomValue } from './contracts';

export function CustomMetadataList({
  values,
  needsMetadata,
}: {
  values: Metadata['customDisplay'];
  needsMetadata?: boolean;
}) {
  const entries = Object.entries(values ?? {});
  if (!entries.length && !needsMetadata) return null;
  return (
    <section
      className="my-5 rounded-xl border border-slate-700 p-4"
      aria-label="Custom metadata"
    >
      <h2 className="font-semibold">Custom metadata</h2>
      {needsMetadata && (
        <p className="mt-2 text-sm text-amber-200">
          This record needs metadata review under the current published form.
        </p>
      )}
      {entries.length ? (
        <dl className="mt-3 space-y-3">
          {entries.map(([id, entry]) => (
            <div key={id}>
              <dt className="font-medium">
                {entry.label || id}
                {entry.legacy && (
                  <span className="ml-2 text-xs text-amber-200">
                    Legacy value
                  </span>
                )}
              </dt>
              <dd className="whitespace-pre-wrap break-words">
                {formatCustomValue(entry.value, entry.option_paths)}
              </dd>
              <dd className="break-all text-xs text-slate-400">
                Field {id} · validated revision {entry.validated_revision_id}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-slate-400">
          No custom values recorded.
        </p>
      )}
    </section>
  );
}
