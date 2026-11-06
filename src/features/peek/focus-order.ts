/** Document keyboard targets after the trigger, excluding this portalled preview.
 * Do not use client-rect dimensions: native controls and jsdom need no box test.
 */
const candidates =
  'a[href],area[href],button,input:not([type="hidden"]),select,textarea,summary,iframe,object,embed,audio[controls],video[controls],[contenteditable]:not([contenteditable="false"]),[tabindex]';
function keyboardReachable(node: HTMLElement) {
  if (
    !node.isConnected ||
    node.matches(':disabled') ||
    node.closest('[hidden], [inert], dialog:not([open])')
  )
    return false;
  if (node.hasAttribute('tabindex') && node.tabIndex < 0) return false;
  if (node instanceof HTMLInputElement && node.type === 'hidden') return false;
  if (node.tagName === 'SUMMARY' && !node.hasAttribute('tabindex')) {
    const parent = node.parentElement;
    if (
      parent?.tagName !== 'DETAILS' ||
      [...parent.children].find((child) => child.tagName === 'SUMMARY') !== node
    )
      return false;
  }
  const view = node.ownerDocument.defaultView;
  const visibility = view?.getComputedStyle(node).visibility;
  if (visibility === 'hidden' || visibility === 'collapse') return false;
  for (
    let ancestor: HTMLElement | null = node;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = view?.getComputedStyle(ancestor);
    if (
      style?.display === 'none' ||
      style?.getPropertyValue('content-visibility') === 'hidden'
    )
      return false;
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = [...ancestor.children].find(
        (child) => child.tagName === 'SUMMARY',
      );
      if (!summary?.contains(node)) return false;
    }
  }
  return true;
}
export function focusAfterPeek(
  trigger: HTMLElement | null,
  preview: HTMLElement | null,
) {
  if (!trigger || !preview) return false;
  const document = trigger.ownerDocument;
  const ordered = [
    ...document.querySelectorAll<HTMLElement>(candidates),
  ].filter((node) => !preview.contains(node) && keyboardReachable(node));
  const index = ordered.indexOf(trigger);
  if (index < 0) return false;
  for (const candidate of ordered.slice(index + 1)) {
    candidate.focus();
    if (document.activeElement === candidate) return true;
  }
  return false;
}
