import type { Page } from '@playwright/test';

type Field = 'name' | 'code' | 'notes';
type Options = {
  pathname: string;
  expected: Partial<Record<Field, string>>;
  captureDraft?: boolean;
};
type Entry = Record<string, string | number | boolean | null>;
declare global {
  interface Window {
    formHandoffDiagnostics?: {
      snapshot: () => { entries: Entry[]; dropped: number; fields: Entry[] };
      dispose: () => void;
    };
  }
}

/** Self-contained for Playwright init-script serialization. Never records values. */
export function attachFormHandoffDiagnostics(options: Options) {
  window.formHandoffDiagnostics?.dispose();
  const entries: Entry[] = [];
  const nodes = new WeakMap<Element, number>();
  let nextNode = 1;
  let order = 0;
  let dropped = 0;
  let lastOwned: Element | null = null;
  const append = (entry: Entry) => {
    if (entries.length === 128) {
      entries.shift();
      dropped++;
    }
    entries.push({
      order: ++order,
      ms: Math.round(performance.now()),
      ...entry,
    });
  };
  const activeRoute = () => location.pathname === options.pathname;
  const field = (target: EventTarget | null): Field | null => {
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) ||
      !target.closest('form')
    )
      return null;
    const label = target.getAttribute('aria-label');
    const result =
      label === 'Name'
        ? 'name'
        : label === 'Permanent code'
          ? 'code'
          : target instanceof HTMLTextAreaElement &&
              target.id.endsWith('-notes')
            ? 'notes'
            : null;
    return result && Object.hasOwn(options.expected, result) ? result : null;
  };
  const state = (target: Element): Entry => {
    if (!nodes.has(target)) nodes.set(target, nextNode++);
    const key = field(target);
    return {
      node: nodes.get(target)!,
      field: key ?? 'other',
      connected: target.isConnected,
      disabled: 'disabled' in target && target.disabled === true,
      length: key ? (target as HTMLInputElement).value.length : 0,
      matches:
        !!key && (target as HTMLInputElement).value === options.expected[key],
      focused: document.activeElement === target,
      activeField: field(document.activeElement) ?? 'other',
      activeTag: document.activeElement?.tagName ?? 'NONE',
    };
  };
  const events = ['focusin', 'focusout', 'beforeinput', 'input', 'change'];
  const observe = (event: Event) => {
    if (!activeRoute() || !(event.target instanceof Element)) return;
    const key = field(event.target);
    if (!key && !lastOwned) return;
    if (key) lastOwned = event.target;
    append({
      event: event.type,
      trusted: event.isTrusted,
      ...state(event.target),
    });
    if (key && (event.type === 'input' || event.type === 'change')) {
      const target = event.target;
      queueMicrotask(() =>
        append({ event: event.type + '-settled', ...state(target) }),
      );
    }
  };
  events.forEach((event) => document.addEventListener(event, observe, true));
  const originalSet = Storage.prototype.setItem;
  const tracedSet: typeof originalSet = function (this: Storage, key, value) {
    const result = originalSet.call(this, key, value);
    if (
      !options.captureDraft ||
      !activeRoute() ||
      typeof key !== 'string' ||
      typeof value !== 'string' ||
      !key.startsWith('inventory-site-task-v1:') ||
      value.length > 65536
    )
      return result;
    try {
      const envelope = JSON.parse(value);
      const draft = new URL(location.href).searchParams.get('siteDraft');
      if (this !== sessionStorage || !draft || envelope.scope?.draft !== draft)
        return result;
      const entry: Entry = {
        event: 'draft-write',
        sequence:
          typeof envelope.sequence === 'number' ? envelope.sequence : -1,
      };
      for (const key of ['name', 'code', 'notes'] as const) {
        if (!Object.hasOwn(options.expected, key)) continue;
        const value = envelope.values?.[key];
        entry[key + 'Length'] = typeof value === 'string' ? value.length : -1;
        entry[key + 'Matches'] = value === options.expected[key];
      }
      append(entry);
    } catch {
      /* Diagnostics cannot change application storage behavior. */
    }
    return result;
  };
  Storage.prototype.setItem = tracedSet;
  const originalTransition = document.startViewTransition;
  const tracedTransition: typeof originalTransition = function (...args) {
    const result = originalTransition.apply(document, args);
    append({ event: 'transition-start', owningRoute: activeRoute() });
    for (const phase of ['updateCallbackDone', 'ready', 'finished'] as const) {
      void result[phase].then(
        () =>
          append({ event: 'transition-' + phase, owningRoute: activeRoute() }),
        () =>
          append({
            event: 'transition-' + phase + '-rejected',
            owningRoute: activeRoute(),
          }),
      );
    }
    return result;
  };
  if (typeof originalTransition === 'function')
    document.startViewTransition = tracedTransition;
  window.formHandoffDiagnostics = {
    snapshot: () => ({
      entries: entries.map((entry) => ({ ...entry })),
      dropped,
      fields: activeRoute()
        ? Array.from(document.querySelectorAll('form input, form textarea'))
            .filter((node) => field(node))
            .slice(0, 3)
            .map(state)
        : [],
    }),
    dispose: () => {
      events.forEach((event) =>
        document.removeEventListener(event, observe, true),
      );
      if (Storage.prototype.setItem === tracedSet)
        Storage.prototype.setItem = originalSet;
      if (document.startViewTransition === tracedTransition)
        document.startViewTransition = originalTransition;
      delete window.formHandoffDiagnostics;
    },
  };
}

export async function installFormHandoffDiagnostics(
  page: Page,
  options: Options,
) {
  await page.addInitScript(attachFormHandoffDiagnostics, options);
  return async () => {
    const snapshot = await page
      .evaluate(() => window.formHandoffDiagnostics?.snapshot() ?? null)
      .catch(() => null);
    console.log('FORM_HANDOFF_DIAGNOSTICS ' + JSON.stringify(snapshot));
  };
}
