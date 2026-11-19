import { readFileSync } from 'node:fs';
import { StrictMode } from 'react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '@/features/scan/assign-batch';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThemeStore } from './theme-store';
import { ownThemeSnapshot } from './native-transition-owner';
import {
  QuickThemeToggle,
  ThemeControl,
  ThemePreferenceProvider,
  VerifiedThemeScope,
} from './theme-preference';
const bootstrap = readFileSync('public/theme-bootstrap.v1.js', 'utf8');
const scope = 'app:backend:actor-one';
let system: MediaQueryList;
let listeners: Set<() => void>;
beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.themeScope = scope;
  document.documentElement.dataset.motion = 'reduced';
  listeners = new Set();
  system = {
    matches: true,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', () => system);
  window.eval(bootstrap);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete window.inventoryTheme;
});
it('has native keyboard radios, defaults Dark, persists and quick-toggle chooses opposite resolved appearance', async () => {
  const user = userEvent.setup();
  render(
    <ThemePreferenceProvider scope={scope}>
      <ThemeControl />
      <QuickThemeToggle />
    </ThemePreferenceProvider>,
  );
  expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  screen.getByRole('radio', { name: 'Dark' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem(window.inventoryTheme!.key(scope))).toBe(
    '{"version":1,"preference":"light"}',
  );
  await user.click(
    screen.getByRole('button', { name: 'Switch to Dark theme' }),
  );
  expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
  await user.click(screen.getByRole('radio', { name: 'System' }));
  expect(document.documentElement.dataset.theme).toBe('light');
  await user.click(
    screen.getByRole('button', { name: 'Switch to Dark theme' }),
  );
  expect(document.documentElement.dataset.themePreference).toBe('dark');
});
it('changes System with OS only when explicitly selected and tears down its listeners', () => {
  const store = createThemeStore(scope);
  const dispose = store.mount();
  expect(store.snapshot().theme).toBe('dark');
  act(() => listeners.forEach((fn) => fn()));
  expect(store.snapshot().theme).toBe('dark');
  store.choose('system');
  Object.defineProperty(system, 'matches', {
    value: false,
    configurable: true,
  });
  act(() => listeners.forEach((fn) => fn()));
  expect(store.snapshot()).toMatchObject({
    preference: 'system',
    theme: 'dark',
  });
  dispose();
  expect(listeners.size).toBe(0);
});
it('retains a volatile current-tab choice when storage denies reads/writes', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked');
  });
  const store = createThemeStore(scope);
  const dispose = store.mount();
  expect(store.snapshot().theme).toBe('dark');
  store.choose('light');
  expect(store.snapshot().theme).toBe('light');
  store.scope('app:backend:actor-two');
  expect(store.snapshot().theme).toBe('dark');
  dispose();
});
it('uses only exact matching storage events and adopts a newly verified actor without leaking preferences', () => {
  const store = createThemeStore(scope);
  const dispose = store.mount();
  const key = window.inventoryTheme!.key(scope);
  store.choose('light');
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: 'another-key',
      newValue: '{"version":1,"preference":"dark"}',
    }),
  );
  expect(store.snapshot().theme).toBe('light');
  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      newValue: '{"version":1,"preference":"dark"}',
    }),
  );
  expect(store.snapshot().theme).toBe('dark');
  store.choose('light');
  store.scope('app:backend:anonymous');
  expect(store.snapshot().theme).toBe('dark');
  store.scope(scope);
  expect(store.snapshot().theme).toBe('light');
  dispose();
});
it('retains children and focus while a verified scope replaces the preference', async () => {
  const user = userEvent.setup();
  const view = render(
    <ThemePreferenceProvider scope={scope}>
      <VerifiedThemeScope scope={scope} />
      <input aria-label="Draft" />
      <ThemeControl />
    </ThemePreferenceProvider>,
  );
  await user.type(screen.getByRole('textbox', { name: 'Draft' }), 'unsaved');
  const input = screen.getByRole('textbox', { name: 'Draft' });
  view.rerender(
    <ThemePreferenceProvider scope={scope}>
      <VerifiedThemeScope scope="app:backend:actor-two" />
      <input aria-label="Draft" />
      <ThemeControl />
    </ThemePreferenceProvider>,
  );
  expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(input);
  expect(input).toHaveValue('unsaved');
  expect(input).toHaveFocus();
});

it('retires callbacks and queued listeners on dispose, and old cleanup/commands cannot influence a remounted owner', () => {
  const store = createThemeStore(scope);
  const dispose = store.mount();
  const choose = store.choose;
  const setScope = store.scope;
  const reset = store.resetScope;
  const queued = [...listeners];
  store.choose('system');
  dispose();
  const apply = vi.spyOn(window.inventoryTheme!, 'apply');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const theme = document.documentElement.dataset.theme;
  choose('dark');
  setScope('app:backend:retired');
  reset('app:backend:anonymous');
  queued.forEach((listener) => listener());
  expect(apply).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(store.snapshot().scope).toBe(scope);
  const remount = store.mount();
  apply.mockClear();
  writes.mockClear();
  dispose();
  choose('dark');
  setScope('app:backend:retired');
  reset('app:backend:anonymous');
  queued.forEach((listener) => listener());
  expect(apply).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
  store.choose('dark');
  expect(apply).toHaveBeenCalledOnce();
  expect(writes).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(1);
  remount();
  expect(listeners.size).toBe(0);
});

describe.each(['choose', 'scope', 'resetScope'] as const)(
  '%s scope lifetime',
  (command) => {
    it.each(['scope change', 'forced reset', 'round trip'] as const)(
      'rejects a retained command after %s even when the actor key returns',
      (retirement) => {
        const store = createThemeStore(scope);
        const dispose = store.mount();
        const old =
          command === 'choose'
            ? () => retainedChoose('light')
            : command === 'scope'
              ? () => retainedScope('app:backend:retired')
              : () => retainedReset('app:backend:retired');
        const retainedChoose = store.choose;
        const retainedScope = store.scope;
        const retainedReset = store.resetScope;
        if (retirement === 'forced reset') store.resetScope(scope);
        else {
          store.scope('app:backend:actor-two');
          if (retirement === 'round trip') store.scope(scope);
        }
        const snapshot = store.snapshot();
        const apply = vi.spyOn(window.inventoryTheme!, 'apply');
        const writes = vi.spyOn(Storage.prototype, 'setItem');
        const read = vi.spyOn(window.inventoryTheme!, 'read');
        const before = document.documentElement.outerHTML;
        try {
          old();
          expect(store.snapshot()).toBe(snapshot);
          expect(document.documentElement.outerHTML).toBe(before);
          expect(apply).not.toHaveBeenCalled();
          expect(writes).not.toHaveBeenCalled();
          expect(read).not.toHaveBeenCalled();
          store.choose('light');
          expect(store.snapshot()).toMatchObject({
            scope: snapshot.scope,
            theme: 'light',
          });
          expect(writes).toHaveBeenCalledExactlyOnceWith(
            window.inventoryTheme!.key(snapshot.scope),
            '{"version":1,"preference":"light"}',
          );
        } finally {
          dispose();
        }
      },
    );

    it('retires retained commands before native cancellation can reenter them', () => {
      const store = createThemeStore(scope);
      const dispose = store.mount();
      const choose = store.choose,
        setScope = store.scope,
        reset = store.resetScope;
      const apply = vi.spyOn(window.inventoryTheme!, 'apply');
      const writes = vi.spyOn(Storage.prototype, 'setItem');
      const cancel = vi.fn(() => {
        if (command === 'choose') choose('light');
        else if (command === 'scope') setScope('app:backend:retired');
        else reset('app:backend:retired');
        expect(apply).not.toHaveBeenCalled();
        expect(writes).not.toHaveBeenCalled();
      });
      ownThemeSnapshot(cancel);
      try {
        store.resetScope('app:backend:anonymous');
        expect(cancel).toHaveBeenCalledOnce();
        expect(store.snapshot().scope).toBe('app:backend:anonymous');
        expect(apply).toHaveBeenCalledOnce();
      } finally {
        dispose();
      }
    });
  },
);

it('preserves no-op same-scope commands and current commands after each real retirement', () => {
  const store = createThemeStore(scope);
  const dispose = store.mount();
  const choose = store.choose;
  store.scope(scope);
  choose('light');
  expect(store.snapshot().theme).toBe('light');
  store.resetScope(scope);
  store.choose('dark');
  store.scope('app:backend:actor-two');
  store.choose('light');
  expect(store.snapshot()).toMatchObject({
    scope: 'app:backend:actor-two',
    theme: 'light',
  });
  store.resetScope('app:backend:anonymous');
  expect(store.snapshot()).toMatchObject({
    scope: 'app:backend:anonymous',
    theme: 'dark',
  });
  dispose();
});

it('keeps current OS and exact-scope storage synchronization after a scope revision', () => {
  const next = 'app:backend:actor-two';
  localStorage.setItem(
    window.inventoryTheme!.key(next),
    '{"version":1,"preference":"system"}',
  );
  const store = createThemeStore(scope);
  const dispose = store.mount();
  store.scope(next);
  expect(store.snapshot()).toMatchObject({
    scope: next,
    preference: 'system',
    theme: 'light',
  });
  Object.assign(system, { matches: false });
  listeners.forEach((listener) => listener());
  expect(store.snapshot().theme).toBe('dark');
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: window.inventoryTheme!.key(scope),
      newValue: '{"version":1,"preference":"light"}',
    }),
  );
  expect(store.snapshot().theme).toBe('dark');
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: window.inventoryTheme!.key(next),
      newValue: '{"version":1,"preference":"light"}',
    }),
  );
  expect(store.snapshot()).toMatchObject({
    scope: next,
    preference: 'light',
    theme: 'light',
  });
  dispose();
});

it('StrictMode re-arms only the committed lifecycle before a fresh member child establishes its scope', () => {
  const actor = 'app:backend:verified';
  localStorage.setItem(
    `it-inventory:theme:v1:${actor}`,
    '{"version":1,"preference":"light"}',
  );
  const view = render(
    <StrictMode>
      <ThemePreferenceProvider scope="app:backend:anonymous">
        <PrivacyReadinessContext
          value={{
            ready: true,
            visible: true,
            generation: 'managed',
            verifiedEpoch: assignmentEpoch(),
            revocationRevision: readPrivacyRevocationRevision(),
          }}
        >
          <VerifiedThemeScope scope={actor} />
          <ThemeControl />
        </PrivacyReadinessContext>
      </ThemePreferenceProvider>
    </StrictMode>,
  );
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked();
  expect(document.documentElement.dataset.themeScope).toBe(actor);
  view.unmount();
  expect(listeners.size).toBe(0);
});
