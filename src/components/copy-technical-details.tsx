'use client';
import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
export function CopyTechnicalDetails({ details }: { details: string }) {
  const [message, setMessage] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const disclosureId = useId();
  const manualCopy = useRef<HTMLTextAreaElement>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(details);
            setMessage('Technical details copied.');
          } catch {
            setCopyFailed(true);
            setMessage(
              'Could not copy technical details. Show the details to copy them manually, or try again.',
            );
          }
        }}
      >
        Copy technical details
      </Button>
      {message && (
        <span role="status" className="text-sm">
          {message}
        </span>
      )}
      {copyFailed && (
        <Button
          type="button"
          variant="outline"
          aria-expanded={showDetails}
          aria-controls={disclosureId}
          onClick={() => setShowDetails((shown) => !shown)}
        >
          {showDetails ? 'Hide technical details' : 'Show technical details'}
        </Button>
      )}
      {showDetails && (
        <span id={disclosureId} className="flex w-full flex-col gap-2">
          <span>
            Copy the selected text using your device&apos;s copy command.
          </span>
          <textarea
            ref={manualCopy}
            aria-label="Technical details for manual copying"
            readOnly
            value={details}
            rows={Math.min(8, Math.max(3, details.split('\n').length))}
            className="w-full min-w-0 rounded border p-2 font-mono text-sm"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              manualCopy.current?.focus();
              manualCopy.current?.select();
            }}
          >
            Select technical details
          </Button>
        </span>
      )}
    </span>
  );
}
