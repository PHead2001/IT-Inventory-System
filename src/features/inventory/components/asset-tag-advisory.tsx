'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { checkAssetTag, type AssetTagConflict } from '../asset-tag.actions';

type Result = { key: string } & (
  | { status: 'checking' | 'clear' | 'failed' }
  | { status: 'conflict'; record: AssetTagConflict }
);
export function useAssetTagAdvisory({
  value,
  owner,
  excludeId,
  enabled,
}: {
  value: string;
  owner: string;
  excludeId?: string;
  enabled: boolean;
}) {
  const generation = useRef(0);
  const key = JSON.stringify([value, owner, excludeId, enabled]);
  const [result, setResult] = useState<Result | null>(null);
  const advanceGeneration = useCallback(() => ++generation.current, []);
  useLayoutEffect(() => {
    advanceGeneration();
    return () => {
      advanceGeneration();
    };
  }, [key, advanceGeneration]);
  const invalidate = useCallback(() => {
    advanceGeneration();
    setResult(null);
  }, [advanceGeneration]);
  const check = async () => {
    if (!enabled || !value.trim()) {
      invalidate();
      return;
    }
    const token = advanceGeneration();
    setResult({ key, status: 'checking' });
    try {
      const record = await checkAssetTag(value, excludeId);
      if (token !== generation.current) return;
      setResult(
        record ? { key, status: 'conflict', record } : { key, status: 'clear' },
      );
    } catch {
      if (token === generation.current) setResult({ key, status: 'failed' });
    }
  };
  return {
    check,
    invalidate,
    result: enabled && result?.key === key ? result : null,
  };
}

export function AssetTagAdvisory({
  id,
  result,
}: {
  id: string;
  result: Result | null;
}) {
  return (
    <div
      id={id}
      role="status"
      className="min-h-6 break-words text-sm text-[var(--muted)]"
    >
      {result?.status === 'checking' && 'Checking asset tag…'}
      {result?.status === 'clear' &&
        'No conflicting tag found. Saving checks again.'}
      {result?.status === 'failed' &&
        'Asset tag could not be checked. Try leaving the field again; saving still checks for duplicates.'}
      {result?.status === 'conflict' && (
        <span className="text-[var(--warning)]">
          Asset tag already used by{' '}
          <Link
            href={'/inventory/assets/' + result.record.id}
            className="underline"
          >
            {result.record.name}
          </Link>{' '}
          ({result.record.status === 'retired' ? 'retired' : 'active'}). Choose
          another tag.
        </span>
      )}
    </div>
  );
}
