'use client';

const navigationEvent = 'it-inventory:navigation-request';
export type NavigationAttempt = { url: URL; invoker: HTMLElement | null };

// Commands and ordinary primary-click links share the same leave decision.
// The caller owns navigation; a guard owns its existing draft/recovery UI.
export function requestAppNavigation(
  href: string,
  invoker: HTMLElement | null,
) {
  return document.dispatchEvent(
    new CustomEvent<NavigationAttempt>(navigationEvent, {
      cancelable: true,
      detail: { url: new URL(href, window.location.href), invoker },
    }),
  );
}

export function registerNavigationGuard(
  allow: (attempt: NavigationAttempt) => boolean,
) {
  const command = (event: Event) => {
    const attempt = (event as CustomEvent<NavigationAttempt>).detail;
    if (!event.defaultPrevented && !allow(attempt)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const link = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    const anchor =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>('a[href]')
        : null;
    if (
      !anchor ||
      anchor.hasAttribute('data-command-navigation') ||
      anchor.hasAttribute('download') ||
      (anchor.target && anchor.target !== '_self') ||
      anchor.getAttribute('href')?.startsWith('#')
    )
      return;
    if (
      !allow({
        url: new URL(anchor.href, window.location.href),
        invoker: anchor,
      })
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener(navigationEvent, command);
  document.addEventListener('click', link, true);
  return () => {
    document.removeEventListener(navigationEvent, command);
    document.removeEventListener('click', link, true);
  };
}
