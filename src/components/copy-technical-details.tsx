'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
export function CopyTechnicalDetails({ details }: { details: string }) {
  const [message, setMessage] = useState('');
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
            setMessage('Could not copy technical details. Try again.');
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
    </span>
  );
}
