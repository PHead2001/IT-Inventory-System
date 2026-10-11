'use client';
import { OperationalTimestamp } from '@/components/operational-time';
import { CopyTechnicalDetails } from '@/components/copy-technical-details';
import { custodyEventLabel } from './vocabulary';
import { countLabel } from '@/lib/count';
import type { CustodyReceipt } from './contracts';

export function CustodyReceiptView({
  receipt,
  reviewedName,
}: {
  receipt: CustodyReceipt;
  reviewedName?: string;
}) {
  const correction =
    receipt.operation === 'corrected' && receipt.quantity !== null;
  const correctionLine =
    receipt.source?.kind === 'site' &&
    receipt.source.before !== undefined &&
    receipt.source.delta !== undefined &&
    receipt.source.after !== undefined
      ? {
          before: receipt.source.before,
          delta: receipt.source.delta,
          after: receipt.source.after,
        }
      : null;
  return (
    <section aria-label="Committed custody receipt" className="space-y-3">
      <h3 className="text-lg font-semibold">
        {custodyEventLabel(
          receipt.operation,
          receipt.quantity === null ? 'asset' : 'quantity',
        )}
      </h3>
      {reviewedName && (
        <p className="break-words font-medium">{reviewedName} </p>
      )}
      {correction ? (
        <>
          <p>Count correction at {receipt.source?.name ?? 'Recorded site'}</p>
          {correctionLine ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-slate-300">
                  Count before correction
                </dt>
                <dd className="font-semibold">
                  {countLabel(correctionLine.before, 'unit')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-300">Signed adjustment</dt>
                <dd className="font-semibold">
                  {correctionLine.delta > 0
                    ? '+'
                    : correctionLine.delta < 0
                      ? '-'
                      : ''}
                  {countLabel(Math.abs(correctionLine.delta), 'unit')}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-slate-300">
                  Observed count after correction
                </dt>
                <dd className="font-semibold">
                  {countLabel(correctionLine.after, 'unit')}
                </dd>
              </div>
            </dl>
          ) : (
            <p>Correction count details are unavailable in this receipt.</p>
          )}
        </>
      ) : (
        <>
          <p>
            {receipt.quantity !== null
              ? countLabel(receipt.quantity, 'unit')
              : '1 individual asset'}{' '}
            · {receipt.source?.name ?? 'Opening / no source'} →{' '}
            {receipt.destination?.name ?? 'No destination'}
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {receipt.source?.after !== undefined && (
              <div>
                <dt className="text-sm text-slate-300">
                  {receipt.source.name} · remaining after this operation
                </dt>
                <dd className="font-semibold">
                  {countLabel(receipt.source.after, 'unit')}
                </dd>
              </div>
            )}
            {receipt.destination?.after !== undefined && (
              <div>
                <dt className="text-sm text-slate-300">
                  {receipt.destination.name} · balance after this operation
                </dt>
                <dd className="font-semibold">
                  {countLabel(receipt.destination.after, 'unit')}
                </dd>
              </div>
            )}
          </dl>
        </>
      )}
      <p className="text-sm text-slate-300">
        <OperationalTimestamp value={receipt.createdAt} /> · {receipt.actorName}
      </p>
      {receipt.reference && (
        <p className="break-words">
          Ticket number reference: {receipt.reference}
        </p>
      )}
      {receipt.reason && (
        <p className="whitespace-pre-wrap break-words">
          Reason: {receipt.reason}
        </p>
      )}
      <p className="text-xs text-slate-400">
        Receipt balances describe this event. Current holdings may change later.
      </p>
      <CopyTechnicalDetails
        details={`Operation: ${receipt.eventId}\nOperation type: ${receipt.operation}\nRecorded instant: ${receipt.createdAt}`}
      />
    </section>
  );
}
