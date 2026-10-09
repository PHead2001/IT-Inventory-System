'use client';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';

export function RecordName({ name }: { name: string }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <h1
        id={id}
        className={`experience-heading mt-2 break-words ${expanded ? '' : 'line-clamp-3'}`}
      >
        {name}
      </h1>
      <Button
        type="button"
        variant="outline"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? 'Show less' : 'Show full name'}
      </Button>
    </div>
  );
}
