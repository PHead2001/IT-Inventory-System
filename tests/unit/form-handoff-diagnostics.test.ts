import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachFormHandoffDiagnostics } from '../e2e/form-handoff-diagnostics';

beforeEach(() => {
  window.history.replaceState(
    null,
    '',
    '/settings/sites?siteDraft=owned-draft',
  );
  document.body.innerHTML =
    '<form><input aria-label="Name"><textarea id="owned-notes"></textarea></form>';
});
afterEach(() => {
  window.formHandoffDiagnostics?.dispose();
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it('bounds native input history and records matches without values or input data', async () => {
  const privateValue = 'PRIVATE-FIXTURE-NAME';
  attachFormHandoffDiagnostics({
    pathname: '/settings/sites',
    expected: { name: privateValue },
  });
  const input = document.querySelector('input')!;
  input.focus();
  input.value = privateValue;
  for (let index = 0; index < 200; index++) {
    input.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: privateValue }),
    );
  }
  await Promise.resolve();
  const snapshot = window.formHandoffDiagnostics!.snapshot();
  expect(snapshot.entries).toHaveLength(128);
  expect(snapshot.dropped).toBeGreaterThan(200);
  expect(snapshot.fields).toMatchObject([
    { field: 'name', matches: true, focused: true },
  ]);
  expect(JSON.stringify(snapshot)).not.toContain(privateValue);
});

it('observes only matching owned draft writes and leaves storage bytes unchanged', () => {
  const privateValue = 'PRIVATE-DRAFT-NAME';
  attachFormHandoffDiagnostics({
    pathname: '/settings/sites',
    expected: { name: privateValue },
    captureDraft: true,
  });
  const key = 'inventory-site-task-v1:owned';
  const value = JSON.stringify({
    scope: { draft: 'owned-draft' },
    sequence: 3,
    values: { name: privateValue },
  });
  sessionStorage.setItem('unrelated-secret', privateValue);
  sessionStorage.setItem(null as unknown as string, null as unknown as string);
  expect(sessionStorage.getItem('null')).toBe('null');
  sessionStorage.setItem(
    key,
    JSON.stringify({
      scope: { draft: 'other' },
      values: { name: privateValue },
    }),
  );
  sessionStorage.setItem(key, value);
  sessionStorage.setItem('inventory-site-task-v1:invalid', 'not-json');
  expect(sessionStorage.getItem(key)).toBe(value);
  const snapshot = window.formHandoffDiagnostics!.snapshot();
  expect(snapshot.entries).toMatchObject([
    {
      event: 'draft-write',
      sequence: 3,
      nameMatches: true,
      nameLength: privateValue.length,
    },
  ]);
  expect(snapshot.entries).toHaveLength(1);
  expect(JSON.stringify(snapshot)).not.toContain(privateValue);
  expect(JSON.stringify(snapshot)).not.toContain('owned-draft');
});

it('keeps native transition identity, arguments and completion untouched and restores observers', async () => {
  const result = {
    updateCallbackDone: Promise.resolve(),
    ready: Promise.resolve(),
    finished: Promise.resolve(),
    skipTransition: vi.fn(),
  } as unknown as ViewTransition;
  const native = vi.fn(() => result);
  Object.defineProperty(document, 'startViewTransition', {
    value: native,
    configurable: true,
    writable: true,
  });
  const originalSet = Storage.prototype.setItem;
  attachFormHandoffDiagnostics({
    pathname: '/settings/sites',
    expected: { name: 'private' },
  });
  const update = vi.fn();
  expect(document.startViewTransition(update)).toBe(result);
  expect(native).toHaveBeenCalledExactlyOnceWith(update);
  await Promise.resolve();
  expect(
    window
      .formHandoffDiagnostics!.snapshot()
      .entries.map((entry) => entry.event),
  ).toEqual([
    'transition-start',
    'transition-updateCallbackDone',
    'transition-ready',
    'transition-finished',
  ]);
  expect(result.skipTransition).not.toHaveBeenCalled();
  window.formHandoffDiagnostics!.dispose();
  expect(document.startViewTransition).toBe(native);
  expect(Storage.prototype.setItem).toBe(originalSet);
  Reflect.deleteProperty(document, 'startViewTransition');
});

it('preserves storage failures and ignores input outside the owned route', () => {
  const failure = new Error('original storage failure');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw failure;
  });
  attachFormHandoffDiagnostics({
    pathname: '/settings/sites',
    expected: { name: 'private' },
    captureDraft: true,
  });
  expect(() =>
    sessionStorage.setItem('inventory-site-task-v1:owned', '{}'),
  ).toThrow(failure);
  window.history.replaceState(null, '', '/settings');
  document
    .querySelector('input')!
    .dispatchEvent(new InputEvent('input', { bubbles: true, data: 'private' }));
  expect(window.formHandoffDiagnostics!.snapshot().entries).toEqual([]);
  expect(window.formHandoffDiagnostics!.snapshot().fields).toEqual([]);
});
