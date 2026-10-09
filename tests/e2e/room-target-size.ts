export type RoomTargetSize = {
  layoutWidth: number;
  layoutHeight: number;
  width: number;
  height: number;
  translationOnly: boolean;
};

// Chromium returned 43.99999237060547 for an authored 44px translated button.
// This allowance belongs only to measurement, never layout/collision budgets.
export function roomTargetMeetsMinimum(size: RoomTargetSize) {
  return (
    size.translationOnly &&
    size.layoutWidth >= 44 &&
    size.layoutHeight >= 44 &&
    size.width >= 43.99 &&
    size.height >= 43.99
  );
}

export function measureRoomTarget(element: HTMLElement): RoomTargetSize {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  const extra = (properties: string[]) =>
    style.boxSizing === 'border-box'
      ? 0
      : properties.reduce(
          (sum, property) =>
            sum + (parseFloat(style.getPropertyValue(property)) || 0),
          0,
        );
  let translationOnly = true;
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    const computed = getComputedStyle(node);
    const matrix = new DOMMatrixReadOnly(
      computed.transform === 'none' ? undefined : computed.transform,
    );
    translationOnly &&=
      matrix.is2D &&
      matrix.a === 1 &&
      matrix.b === 0 &&
      matrix.c === 0 &&
      matrix.d === 1 &&
      (computed.scale === 'none' || computed.scale === '1') &&
      computed.rotate === 'none';
  }
  return {
    layoutWidth:
      parseFloat(style.width) +
      extra([
        'padding-left',
        'padding-right',
        'border-left-width',
        'border-right-width',
      ]),
    layoutHeight:
      parseFloat(style.height) +
      extra([
        'padding-top',
        'padding-bottom',
        'border-top-width',
        'border-bottom-width',
      ]),
    width: rect.width,
    height: rect.height,
    translationOnly,
  };
}
