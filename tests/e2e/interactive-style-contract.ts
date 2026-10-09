import { expect, type Page } from '@playwright/test';

/** Audit the cascade, including inactive/default controls whose duration is zero. */
export async function expectScopedInteractiveTransitions(page: Page) {
  const result = await page.evaluate(() => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        'a, button, input, select, textarea, summary, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="treeitem"], [role="option"], [contenteditable="true"], [tabindex]',
      ),
    );
    return {
      count: controls.length,
      unscoped: controls
        .filter((element) =>
          getComputedStyle(element)
            .transitionProperty.split(',')
            .some((property) => property.trim() === 'all'),
        )
        .map((element) => ({
          tag: element.tagName,
          role: element.getAttribute('role'),
          classes: element.className,
        })),
    };
  });
  expect(
    result.count,
    'The page must expose real interactive controls',
  ).toBeGreaterThan(0);
  expect(
    result.unscoped,
    'Every computed interactive property list is scoped',
  ).toEqual([]);
}
