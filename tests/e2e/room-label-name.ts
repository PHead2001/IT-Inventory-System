/** Browser-side measurement of the name, excluding the separate count badge. */
export function measureRoomLabelName(element: Element) {
  const full = element.querySelector<HTMLElement>('[data-room-label-full]');
  if (!full) return { text: '', visible: false, rects: [] };
  const nameNodes = [...full.childNodes].filter(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
  );
  const rects = nameNodes.flatMap((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].map((rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }));
  });
  let visible = true;
  for (
    let ancestor: HTMLElement | null = full;
    ancestor;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (
      style.display === 'none' ||
      style.visibility !== 'visible' ||
      Number(style.opacity) === 0
    ) {
      visible = false;
      break;
    }
  }
  return {
    text: nameNodes
      .map((node) => node.textContent)
      .join('')
      .trim(),
    visible,
    rects,
  };
}
