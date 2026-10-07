import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { creationRecoveryLimits } from '@/features/metadata/creation-recovery';
import {
  parseSiteRecovery,
  readSiteRecovery,
  writeSiteRecovery,
  type SiteRecoveryEnvelope,
} from './site-recovery';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = {
  origin: 'https://preview.example',
  backend: 'https://isolated.supabase.co',
  actor: id(1),
  site: id(2),
  draft: id(2),
};
const editing: SiteRecoveryEnvelope = {
  version: 1,
  scope,
  instance: id(3),
  sequence: 0,
  status: 'editing',
  baseline: {
    id: id(2),
    code: 'HQ',
    name: 'Headquarters',
    notes: null,
    active: true,
    version: '1',
  },
  values: { code: '', name: 'Changed label', notes: '' },
  lifecycle: null,
  reason: '',
  command: null,
  completion: null,
};
beforeEach(() => sessionStorage.clear());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function task(n: number): SiteRecoveryEnvelope {
  return {
    ...editing,
    scope: { ...scope, site: id(n), draft: id(n) },
    instance: id(n + 1000),
    baseline: { ...editing.baseline!, id: id(n) },
  };
}
function submitTask(value: SiteRecoveryEnvelope): SiteRecoveryEnvelope {
  const submitted: SiteRecoveryEnvelope = {
    ...value,
    sequence: 1,
    status: 'submitted',
    command: {
      operation: 'site_update',
      requestId: id(Number(value.scope.site!.slice(-12)) + 2000),
      expectedActorId: scope.actor,
      payload: {
        site_id: value.scope.site,
        expected_version: value.baseline!.version,
        name: value.values.name,
        notes: null,
        active: true,
      },
    },
  };
  expect(writeSiteRecovery(submitted, value)).toBe(true);
  return submitted;
}
function completeTask(value: SiteRecoveryEnvelope): SiteRecoveryEnvelope {
  expect(writeSiteRecovery(value, null)).toBe(true);
  const submitted = submitTask(value);
  const saved: SiteRecoveryEnvelope = {
    ...submitted,
    sequence: 2,
    status: 'saved',
    command: null,
    completion: { entityId: value.scope.site!, version: '2', changed: true },
  };
  expect(
    writeSiteRecovery(saved, submitted, submitted.command!.requestId),
  ).toBe(true);
  return saved;
}
it('retains original version and isolates actor/environment/entity/draft identities', () => {
  expect(writeSiteRecovery(editing, null)).toBe(true);
  expect(readSiteRecovery(scope).envelope?.baseline?.version).toBe('1');
  for (const changed of [
    { actor: id(9) },
    { backend: 'https://other.supabase.co' },
    { site: id(8) },
    { draft: id(7) },
  ])
    expect(readSiteRecovery({ ...scope, ...changed }).envelope).toBeNull();
});
it('rejects stale writers and cannot discard or replace an unknown request', () => {
  expect(writeSiteRecovery(editing, null)).toBe(true);
  const submitted: SiteRecoveryEnvelope = {
    ...editing,
    sequence: 1,
    status: 'submitted',
    command: {
      operation: 'site_update',
      expectedActorId: scope.actor,
      requestId: id(5),
      payload: {
        site_id: scope.site,
        expected_version: '1',
        name: 'Changed label',
        notes: null,
        active: true,
      },
    },
  };
  expect(writeSiteRecovery(submitted, editing)).toBe(true);
  expect(
    writeSiteRecovery(
      { ...editing, sequence: 1, values: { ...editing.values, name: 'Stale' } },
      editing,
    ),
  ).toBe(false);
  expect(
    writeSiteRecovery(
      { ...submitted, sequence: 2, status: 'discarded', command: null },
      submitted,
    ),
  ).toBe(false);
  expect(
    writeSiteRecovery(
      { ...submitted, sequence: 2, status: 'editing', command: null },
      submitted,
      id(9),
    ),
  ).toBe(false);
  expect(
    writeSiteRecovery(
      {
        ...submitted,
        sequence: 2,
        status: 'saved',
        command: null,
        completion: { entityId: scope.site!, version: '2', changed: true },
      },
      submitted,
      id(5),
    ),
  ).toBe(true);
});
it('rejects foreign keys, mismatched versions, actor commands and oversized records', () => {
  expect(
    parseSiteRecovery(
      JSON.stringify({ ...editing, unexpected: 'not whitelisted' }),
      scope,
    ),
  ).toBeNull();
  expect(
    parseSiteRecovery(
      JSON.stringify({
        ...editing,
        lifecycle: { active: false, version: '2' },
      }),
      scope,
    ),
  ).toBeNull();
  expect(parseSiteRecovery(' '.repeat(65537), scope)).toBeNull();
});

it('reclaims completed tasks only as needed beyond 32 while preserving unresolved commands and stale-mount CAS', () => {
  const pending = task(100);
  expect(writeSiteRecovery(pending, null)).toBe(true);
  const submitted = submitTask(pending);
  const firstSaved = completeTask(task(101));
  for (let n = 102; n <= 140; n++) {
    const current = task(n);
    if (n % 2) {
      expect(writeSiteRecovery(current, null)).toBe(true);
      expect(
        writeSiteRecovery(
          { ...current, sequence: 1, status: 'discarded' },
          current,
        ),
      ).toBe(true);
    } else completeTask(current);
  }
  const fresh = task(141);
  expect(writeSiteRecovery(fresh, null)).toBe(true);
  expect(sessionStorage.length).toBe(creationRecoveryLimits.instances);
  expect(readSiteRecovery(submitted.scope).envelope).toEqual(submitted);
  expect(readSiteRecovery(firstSaved.scope).envelope).toBeNull();
  expect(
    writeSiteRecovery(
      {
        ...firstSaved,
        status: 'editing',
        completion: null,
        instance: id(9999),
        sequence: 0,
      },
      firstSaved,
    ),
  ).toBe(false);
  expect(readSiteRecovery(fresh.scope).envelope).toEqual(fresh);
});
it('keeps all bounded editing/submitted tasks and invalid data when no terminal capacity can be reclaimed', () => {
  const kept: SiteRecoveryEnvelope[] = [];
  sessionStorage.setItem(
    'inventory-site-task-v1:invalid-terminal',
    JSON.stringify({ ...task(999), status: 'discarded' }),
  );
  for (let n = 1; n < creationRecoveryLimits.instances; n++) {
    const current = task(n + 300);
    expect(writeSiteRecovery(current, null)).toBe(true);
    kept.push(n % 2 ? submitTask(current) : current);
  }
  const invalid = sessionStorage.getItem(
    'inventory-site-task-v1:invalid-terminal',
  );
  expect(writeSiteRecovery(task(900), null)).toBe(false);
  expect(sessionStorage.length).toBe(creationRecoveryLimits.instances);
  expect(
    sessionStorage.getItem('inventory-site-task-v1:invalid-terminal'),
  ).toBe(invalid);
  for (const current of kept)
    expect(readSiteRecovery(current.scope).envelope).toEqual(current);
});
it('reclaims verified terminal bytes while retaining oversized invalid data and the new target', () => {
  // An in-memory Storage avoids jsdom's smaller browser-specific quota while
  // proving the application byte ceiling independently of browser capacity.
  const entries = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, raw: string) => entries.set(key, raw),
    removeItem: (key: string) => entries.delete(key),
    clear: () => entries.clear(),
  });
  const saved = completeTask(task(700));
  const fresh = task(701);
  const size = new TextEncoder().encode(JSON.stringify(fresh)).length;
  const invalid = 'x'.repeat(creationRecoveryLimits.totalBytes - size);
  sessionStorage.setItem('inventory-site-task-v1:invalid-large', invalid);
  expect(writeSiteRecovery(fresh, null)).toBe(true);
  expect(readSiteRecovery(saved.scope).envelope).toBeNull();
  expect(
    sessionStorage.getItem('inventory-site-task-v1:invalid-large') === invalid,
  ).toBe(true);
  expect(readSiteRecovery(fresh.scope).envelope).toEqual(fresh);
});
it('reclaims only enough verified terminal data for an actual smaller browser quota', () => {
  const saved = completeTask(task(800));
  const retained = completeTask(task(801));
  const pending = task(802);
  expect(writeSiteRecovery(pending, null)).toBe(true);
  const submitted = submitTask(pending);
  const fresh = task(803);
  sessionStorage.setItem('other-feature-unsubmitted', 'keep this');
  sessionStorage.setItem(
    'inventory-site-task-v1:invalid-terminal',
    '{"status":"saved"}',
  );
  const originalSet = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (this.length >= 5 && this.getItem(key) === null)
      throw new DOMException(
        'Browser storage quota reached',
        'QuotaExceededError',
      );
    originalSet.call(this, key, value);
  });
  expect(writeSiteRecovery(fresh, null)).toBe(true);
  expect(readSiteRecovery(saved.scope).envelope).toBeNull();
  expect(readSiteRecovery(retained.scope).envelope).toEqual(retained);
  expect(readSiteRecovery(submitted.scope).envelope).toEqual(submitted);
  expect(readSiteRecovery(fresh.scope).envelope).toEqual(fresh);
  expect(sessionStorage.getItem('other-feature-unsubmitted')).toBe('keep this');
  expect(
    sessionStorage.getItem('inventory-site-task-v1:invalid-terminal'),
  ).toBe('{"status":"saved"}');
});
