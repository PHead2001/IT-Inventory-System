import { beforeEach, describe, expect, it } from 'vitest';
import {
  addEntry,
  clearLabelQueueSession,
  defaultFilters,
  defaultJob,
  parseStoredQueue,
  queueIdentity,
  queueStorageKey,
  totalCopies,
  updateCopies,
  validQueue,
  type QueueEntry,
} from './queue-model';

const uuid = (index: number) =>
  `7b84a7cf-197b-45b1-8016-${index.toString(16).padStart(12, '0')}`;
const entry = (index: number, copies = 1): QueueEntry => ({
  kind: 'quantity',
  key: uuid(index),
  copies,
  baselineTag: null,
  baselineState: 'active',
  lifecycleAcknowledged: true,
});

it('restores bounded copy drafts only for queued identities, including blank, without replacing validated counts', () => {
  const id = queueIdentity(entry(1));
  const stored = {
    entries: [entry(1, 3)],
    filters: defaultFilters,
    job: defaultJob,
  };
  expect(parseStoredQueue(JSON.stringify(stored))?.copyDrafts).toEqual({});
  for (const raw of ['', '101', '1.5', '3', '9'.repeat(100)]) {
    const parsed = parseStoredQueue(
      JSON.stringify({
        ...stored,
        copyDrafts: { [id]: raw, [queueIdentity(entry(2))]: '101' },
      }),
    );
    expect(parsed?.entries[0].copies).toBe(3);
    expect(parsed?.copyDrafts).toEqual({ [id]: raw.slice(0, 80) });
  }
  expect(
    parseStoredQueue(JSON.stringify({ ...stored, copyDrafts: { [id]: 101 } }))
      ?.copyDrafts,
  ).toEqual({});
  expect(
    parseStoredQueue(
      JSON.stringify({ ...stored, copyDrafts: { [id]: '9'.repeat(100_000) } }),
    ),
  ).toBeNull();
});

describe('mixed label queue bounds', () => {
  it('allows 200 distinct records and 500 physical labels, then rejects either excess', () => {
    const full = Array.from({ length: 200 }, (_, index) =>
      entry(index, index < 3 ? 100 : 1),
    );
    // 3*100 + 197 = 497; one location can fill the remaining three labels.
    const mixed = addEntry(full, {
      kind: 'location',
      key: 'ITC',
      copies: 3,
      baselineTag: null,
      baselineState: 'active',
      lifecycleAcknowledged: true,
    });
    expect(mixed).toBeNull();
    expect(validQueue(full)).toBe(true);
    const underDistinct = full.slice(0, 199);
    const atLimit = addEntry(underDistinct, {
      kind: 'location',
      key: 'ITC',
      copies: 4,
      baselineTag: null,
      baselineState: 'active',
      lifecycleAcknowledged: true,
    });
    expect(atLimit).not.toBeNull();
    expect(totalCopies(atLimit!)).toBe(500);
    expect(updateCopies(atLimit!, queueIdentity(atLimit![0]), 101)).toBeNull();
    expect(updateCopies(atLimit!, queueIdentity(atLimit![199]), 5)).toBeNull();
    expect(addEntry(atLimit!, entry(201))).toBeNull();
  });

  it('rejects duplicate IDs, fractional/zero copies, and malformed persisted selections', () => {
    expect(validQueue([entry(1), entry(1)])).toBe(false);
    expect(addEntry([entry(1)], entry(1))).toBeNull();
    expect(updateCopies([entry(1)], queueIdentity(entry(1)), 0)).toBeNull();
    expect(updateCopies([entry(1)], queueIdentity(entry(1)), 1.5)).toBeNull();
    expect(
      parseStoredQueue(
        JSON.stringify({
          entries: [{ ...entry(1), key: 'not-a-uuid' }],
          filters: defaultFilters,
          job: defaultJob,
        }),
      ),
    ).toBeNull();
  });

  it('requires historical acknowledgement for queues persisted before that field existed', () => {
    const restored = parseStoredQueue(
      JSON.stringify({
        entries: [
          {
            ...entry(1),
            baselineState: 'archived',
            lifecycleAcknowledged: undefined,
          },
        ],
        filters: defaultFilters,
        job: defaultJob,
      }),
    );
    expect(restored?.entries[0].lifecycleAcknowledged).toBe(false);
  });
});

describe('session-scoped queue', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps member and environment namespaces separate and clears all on logout', () => {
    const first = queueStorageKey('https://branch.example.test', 'member-a');
    const second = queueStorageKey('https://prod.example.test', 'member-a');
    const third = queueStorageKey('https://branch.example.test', 'member-b');
    expect(new Set([first, second, third]).size).toBe(3);
    sessionStorage.setItem(first, 'a');
    sessionStorage.setItem(second, 'b');
    sessionStorage.setItem(third, 'c');
    sessionStorage.setItem('other-application', 'keep');
    clearLabelQueueSession();
    expect(sessionStorage.getItem(first)).toBeNull();
    expect(sessionStorage.getItem(second)).toBeNull();
    expect(sessionStorage.getItem(third)).toBeNull();
    expect(sessionStorage.getItem('other-application')).toBe('keep');
  });
});

it('constructs a validated cached job, retains old media and preserves invalid media for explicit recovery', () => {
  const stored = {
    entries: [entry(1)],
    filters: defaultFilters,
    job: defaultJob,
  };
  const custom = {
    version: 1,
    mode: 'single',
    labelWidth: 700,
    labelHeight: 350,
  };
  expect(parseStoredQueue(JSON.stringify(stored))?.job).toEqual(defaultJob);
  const valid = parseStoredQueue(
    JSON.stringify({
      ...stored,
      job: { ...defaultJob, layout: custom, arbitrary: 'discard' },
    }),
  );
  expect(valid?.job).toEqual({ ...defaultJob, layout: custom });
  for (const invalid of [
    { ...custom, labelWidth: 30 },
    { ...custom, labelWidth: null },
    { ...custom, extra: 0 },
    'not geometry',
  ]) {
    const result = parseStoredQueue(
      JSON.stringify({ ...stored, job: { ...defaultJob, layout: invalid } }),
    );
    expect(result?.entries).toEqual(stored.entries);
    expect(result?.layoutRecovery).toEqual({ value: invalid });
    expect(result?.job).toEqual(defaultJob);
  }
});
