import type { Metadata } from '@/features/inventory/contracts-ui';
import { OperationalTimestamp } from '@/components/operational-time';
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
      className="experience-surface my-5 min-w-0 p-4"
      aria-label="Custom metadata"
    >
      <h2 className="text-lg font-semibold">Custom metadata</h2>
      {needsMetadata && (
        <p className="mt-2 text-sm text-amber-200">
          This record needs metadata review under the current published form.
        </p>
      )}
      {entries.length ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {entries.map(([id, entry]) => (
            <div
              key={id}
              className="min-w-0 rounded-lg border border-cyan-100/10 bg-slate-950/30 p-3"
            >
              <dt className="text-sm font-medium text-slate-300">
                {entry.label || id}
                {entry.legacy && (
                  <span className="ml-2 text-xs text-amber-200">
                    Legacy value
                  </span>
                )}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                {entry.field_type === 'datetime' ? (
                  <OperationalTimestamp value={entry.value} />
                ) : (
                  formatCustomValue(entry.value, entry.option_paths)
                )}
              </dd>
              <dd>
                <details className="mt-2 text-xs text-slate-400">
                  <summary className="min-h-8 cursor-pointer py-1 text-cyan-200">
                    Value provenance
                  </summary>
                  <span className="break-all">
                    Field {id} · validated revision{' '}
                    {entry.validated_revision_id}
                  </span>
                  {entry.field_type === 'datetime' && (
                    <span className="mt-1 block break-all">
                      Recorded timestamp: {formatCustomValue(entry.value, [])}
                    </span>
                  )}
                </details>
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
