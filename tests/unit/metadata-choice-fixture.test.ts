import { readFileSync } from 'node:fs';
import type { Client } from 'pg';
import { expect, it, vi } from 'vitest';
import { verifyChoiceRevisionDisplay } from '../integration/metadata-choice-display';

const categoryId = '5884a564-f2cd-4622-8cf8-1f44f9ab2f7b';
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const randomUUID = () => '5884a564-f2cd-4622-8cf8-1f44f9ab2f7b';
  return { ...actual, randomUUID, default: { ...actual, randomUUID } };
});

it('creates a parity category satisfying the persisted code constraint and rolls back setup failures', async () => {
  const foundation = readFileSync(
    'supabase/migrations/20260904000100_foundation.sql',
    'utf8',
  );
  const pattern = foundation.match(
    /create table public\.categories\s*\([\s\S]*?check \(code ~ '([^']+)'\)/,
  )?.[1];
  expect(pattern).toBeDefined();
  const constraint = new RegExp(pattern!);
  const stopped = new Error('Stop after validating category setup');
  const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
    if (sql.startsWith('insert into public.categories')) {
      expect(parameters?.[0]).toBe(categoryId);
      expect(parameters?.[1]).toMatch(constraint);
      // Keep the complete UUID entropy in a code separate from its unchanged PK.
      expect(
        String(parameters?.[1])
          .slice('PARITY-'.length)
          .replaceAll('-', '')
          .toLowerCase(),
      ).toBe(categoryId.replaceAll('-', ''));
      throw stopped;
    }
    return { rows: [] };
  });
  await expect(
    verifyChoiceRevisionDisplay({ query } as unknown as Client),
  ).rejects.toBe(stopped);
  expect(query.mock.calls[0][0]).toBe('begin');
  expect(query.mock.calls.at(-1)?.[0]).toBe('rollback');
});
