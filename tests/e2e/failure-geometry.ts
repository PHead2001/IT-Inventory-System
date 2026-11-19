import type { Page } from '@playwright/test';

// Serialized into the browser. Keep selectors and helpers inside this function;
// never include text, attribute values, raw URLs, or history/auth state.
export function readFailureGeometry() {
  const finite = (value: number) =>
    Number.isFinite(value)
      ? Math.round(Math.max(-100000, Math.min(100000, value)) * 100) / 100
      : null;
  const elements = [
    ['header', '.experience-header'],
    ['header-inner', '.experience-header-inner'],
    ['inventory-search', 'form[aria-label="Search inventory"]'],
    ['filter-chip', '.experience-filter-chip'],
    ['inventory-results', '.experience-inventory-results'],
    ['inventory-list', 'ul.experience-surface:has(> li[id^="inventory-row-"])'],
    ['inventory-first-row', 'li[id^="inventory-row-"]'],
    ['account', '.experience-account'],
    ['mobile-menu', '.experience-mobile-menu'],
    ['main', '#main-content'],
    ['record-name', '[data-record-name-row]'],
    ['inventory-name', 'li[id^="inventory-row-"] a[href^="/inventory/"]'],
    ['record-tasks', '[aria-label="Record tasks"]'],
    ['command-launcher', 'button[aria-label="Search and commands"]'],
  ] as const;
  const url = new URL(window.location.href);
  const tasks = url.searchParams.getAll('task');
  const active = document.activeElement;
  const tag = (node: Element | null) =>
    node &&
    /^(HTML|BODY|DIV|MAIN|SECTION|HEADER|NAV|H1|H2|H3|A|BUTTON|INPUT|UL|LI|SPAN|SUMMARY|DETAILS)$/.test(
      node.tagName,
    )
      ? node.tagName
      : node
        ? 'OTHER'
        : null;
  return {
    viewport: {
      width: finite(window.innerWidth),
      height: finite(window.innerHeight),
      scrollX: finite(window.scrollX),
      scrollY: finite(window.scrollY),
    },
    root: {
      clientWidth: finite(document.documentElement.clientWidth),
      scrollWidth: finite(document.documentElement.scrollWidth),
    },
    fontStatus:
      document.fonts?.status === 'loaded'
        ? 'loaded'
        : document.fonts?.status === 'loading'
          ? 'loading'
          : document.fonts
            ? 'other'
            : 'unavailable',
    narrowMedia: {
      maxWidth640: window.matchMedia('(max-width: 640px)').matches,
      maxWidth360: window.matchMedia('(max-width: 360px)').matches,
      maxWidth320: window.matchMedia('(max-width: 320px)').matches,
    },
    ready: document.readyState,
    focused: document.hasFocus(),
    activeTag: tag(active),
    activeOwner:
      elements.find(([, selector]) => active?.closest(selector))?.[0] ??
      'other',
    route: /^\/inventory\/assets\/[^/]+$/.test(url.pathname)
      ? 'asset-detail'
      : /^\/inventory\/quantity\/[^/]+$/.test(url.pathname)
        ? 'quantity-detail'
        : url.pathname === '/inventory'
          ? 'inventory'
          : 'other',
    taskCount: Math.min(tasks.length, 10),
    task:
      tasks.length === 1 &&
      (tasks[0] === 'asset_move' || tasks[0] === 'quantity_move')
        ? tasks[0]
        : tasks.length === 0
          ? 'absent'
          : 'other',
    returnToCount: Math.min(url.searchParams.getAll('returnTo').length, 10),
    returnToInventory: url.searchParams.get('returnTo') === '/inventory',
    tasksHash: url.hash === '#tasks',
    privatePresentation:
      document.documentElement.dataset.routeMotionPrivate === 'true',
    elements: elements.map(([owner, selector]) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      const style = node ? getComputedStyle(node) : null;
      const pixels = (value: string | undefined) =>
        value === undefined ? null : finite(Number.parseFloat(value));
      return {
        owner,
        present: !!node,
        tag: tag(node),
        hidden: !!node?.closest('[hidden], [inert], [aria-hidden="true"]'),
        disabled: node instanceof HTMLButtonElement ? node.disabled : null,
        scrollWidth: node ? finite(node.scrollWidth) : null,
        clientWidth: node ? finite(node.clientWidth) : null,
        spacing: style
          ? {
              columnGap: pixels(style.columnGap),
              rowGap: pixels(style.rowGap),
              paddingTop: pixels(style.paddingTop),
              paddingRight: pixels(style.paddingRight),
              paddingBottom: pixels(style.paddingBottom),
              paddingLeft: pixels(style.paddingLeft),
            }
          : null,
        rect: rect
          ? {
              x: finite(rect.x),
              y: finite(rect.y),
              width: finite(rect.width),
              height: finite(rect.height),
            }
          : null,
      };
    }),
  };
}

export async function withFailureGeometry(
  page: Page,
  scenario:
    | 'native-task-reentry'
    | 'inventory-first-row'
    | 'cold-title-admission'
    | 'inventory-horizontal-overflow',
  assertion: () => Promise<void>,
) {
  try {
    await assertion();
  } catch (error) {
    try {
      console.error(
        'bounded-failure-geometry',
        JSON.stringify({
          scenario,
          geometry: await page.evaluate(readFailureGeometry),
        }),
      );
    } catch {
      console.error('bounded-failure-geometry unavailable', scenario);
    }
    throw error;
  }
}
