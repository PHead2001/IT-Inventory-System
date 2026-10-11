import { useRef, type CSSProperties } from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDesignerViewport } from './designer-viewport';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Workspace({
  sticky = true,
  enabled = true,
}: {
  sticky?: boolean;
  enabled?: boolean;
}) {
  const toolbar = useRef<HTMLDivElement>(null);
  const panes = useRef<HTMLDivElement>(null);
  useDesignerViewport(toolbar, panes, enabled);
  return (
    <>
      <div
        ref={toolbar}
        role="toolbar"
        style={
          {
            position: sticky ? 'sticky' : 'static',
            top: 73,
            '--designer-toolbar-sticky': sticky ? 1 : 0,
          } as CSSProperties
        }
      >
        Toolbar
      </div>
      {enabled && <div ref={panes} data-testid="panes" />}
    </>
  );
}
it('remeasures wrapping toolbar height and its computed sticky position, then removes the clearance for document-flow phone tools', () => {
  let height = 84;
  let resized!: () => void;
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const view = render(<Workspace />);
  const panes = screen.getByTestId('panes');
  expect(panes.style.getPropertyValue('--designer-inspector-top')).toBe(
    '173px',
  );
  height = 164;
  act(() => resized());
  expect(panes.style.getPropertyValue('--designer-inspector-top')).toBe(
    '253px',
  );
  const toolbar = screen.getByRole('toolbar');
  toolbar.style.position = 'static';
  toolbar.style.setProperty('--designer-toolbar-sticky', '0');
  act(() => window.dispatchEvent(new Event('resize')));
  expect(panes.style.getPropertyValue('--designer-inspector-top')).toBe('16px');
  view.unmount();
  height = 300;
  act(() => resized());
  expect(disconnect).toHaveBeenCalledOnce();
  expect(panes.style.getPropertyValue('--designer-inspector-top')).toBe('16px');
});

it('recomputes a restored workspace and font wrapping without retaining an old fallback', async () => {
  let height = 200;
  let ready!: () => void;
  const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  const fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => {
      ready = resolve;
    }),
  });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  vi.stubGlobal('innerHeight', 450);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height }) as DOMRect,
  );
  const view = render(<Workspace enabled={false} />);
  try {
    view.rerender(<Workspace />);
    expect(screen.getByTestId('panes')).toHaveAttribute(
      'data-designer-flow',
      'true',
    );
    height = 50;
    await act(async () => ready());
    expect(screen.getByTestId('panes')).not.toHaveAttribute(
      'data-designer-flow',
    );
    height = 220;
    act(() => fonts.dispatchEvent(new Event('loadingdone')));
    expect(screen.getByTestId('panes')).toHaveAttribute(
      'data-designer-flow',
      'true',
    );
    view.rerender(<Workspace enabled={false} />);
    expect(screen.getByRole('toolbar')).not.toHaveAttribute(
      'data-designer-flow',
    );
    height = 40;
    view.rerender(<Workspace />);
    expect(screen.getByTestId('panes')).not.toHaveAttribute(
      'data-designer-flow',
    );
  } finally {
    view.unmount();
    if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
    else Reflect.deleteProperty(document, 'fonts');
  }
});

it('uses document flow before the remaining height becomes unusable and restores bounded mode from the natural sticky configuration', () => {
  let height = 84;
  let resized!: () => void;
  vi.stubGlobal('innerHeight', 300);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ height }) as DOMRect,
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  render(<Workspace />);
  const panes = screen.getByTestId('panes');
  const toolbar = screen.getByRole('toolbar');
  expect(panes).toHaveAttribute('data-designer-flow', 'true');
  expect(toolbar).toHaveAttribute('data-designer-flow', 'true');
  // Simulate the fallback CSS. Its smaller static clearance cannot turn itself off.
  toolbar.style.position = 'static';
  act(() => resized());
  expect(panes).toHaveAttribute('data-designer-flow', 'true');
  expect(panes.style.getPropertyValue('--designer-inspector-top')).toBe('16px');
  vi.stubGlobal('innerHeight', 700);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(panes).not.toHaveAttribute('data-designer-flow');
  expect(toolbar).not.toHaveAttribute('data-designer-flow');
  expect(panes.style.getPropertyValue('--designer-inspector-top')).toBe(
    '173px',
  );
  height = 440;
  act(() => resized());
  expect(panes).toHaveAttribute('data-designer-flow', 'true');
});
