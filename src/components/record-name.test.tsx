import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordName } from './record-name';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
let overflow = false;
let remeasure: () => void;
let fonts: EventTarget & { ready: Promise<void> };
beforeEach(() => {
  overflow = false;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(300);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    () => (overflow ? 180 : 100),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        remeasure = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  fonts = Object.assign(new EventTarget(), { ready: Promise.resolve() });
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'fonts');
});

it('keeps a long literal name accessible and toggles its visual disclosure without replacing or executing it', async () => {
  const name = 'Cat6 cable '.repeat(16) + '<script>alert(1)</script> 🔌';
  const user = userEvent.setup();
  overflow = true;
  render(<RecordName name={name} />);
  const heading = screen.getByRole('heading', { name });
  const toggle = screen.getByRole('button', { name: 'Show full name' });
  expect(toggle).toHaveAttribute('aria-controls', heading.id);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('script')).toBeNull();
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Show less' })).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('heading', { name })).toBe(heading);
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
it('offers no no-op disclosure when the rendered name fits, regardless of its character count', () => {
  const view = render(<RecordName name="Switch" />);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(<RecordName name={'A'.repeat(170)} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('heading')).toHaveTextContent('A'.repeat(170));
});
it('hydrates the same reserved control slot and heading before overflow measurement adds an accessible control', async () => {
  const name = 'Measured overflow, not a character threshold';
  const container = document.createElement('div');
  container.innerHTML = renderToString(<RecordName name={name} />);
  document.body.append(container);
  const slot = container.querySelector('[data-record-name-control]');
  const heading = container.querySelector('h1');
  expect(slot).not.toBeNull();
  expect(slot!.childElementCount).toBe(0);
  overflow = true;
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(container, <RecordName name={name} />);
    });
    expect(container.querySelector('[data-record-name-control]')).toBe(slot);
    expect(container.querySelector('h1')).toBe(heading);
    const control = screen.getByRole('button', { name: 'Show full name' });
    expect(slot).toContainElement(control);
    expect(control).toHaveAttribute('title', 'Show full name');
    expect(control).toHaveAttribute('aria-controls', heading!.id);
    expect(control.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    act(() => {
      overflow = false;
      remeasure();
    });
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('[data-record-name-control]')).toBe(slot);
  } finally {
    act(() => root?.unmount());
    container.remove();
  }
});
it('reacts to resize and font completion and preserves focus when the disclosure becomes unnecessary', async () => {
  render(<RecordName name="Literal <tag> 🔌" />);
  expect(screen.queryByRole('button')).toBeNull();
  act(() => {
    overflow = true;
    remeasure();
  });
  const user = userEvent.setup();
  const button = screen.getByRole('button', { name: 'Show full name' });
  button.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Show less' })).toHaveFocus();
  act(() => {
    overflow = false;
    fonts.dispatchEvent(new Event('loadingdone'));
  });
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('heading')).toHaveFocus();
  expect(document.querySelectorAll('h1')).toHaveLength(1);
  act(() => {
    overflow = true;
    window.dispatchEvent(new Event('resize'));
  });
  expect(
    screen.getByRole('button', { name: 'Show full name' }),
  ).toBeInTheDocument();
});
it('remeasures changed names and font readiness without leaving a duplicate accessible heading', async () => {
  overflow = true;
  let finish!: () => void;
  fonts.ready = new Promise((resolve) => {
    finish = resolve;
  });
  const view = render(<RecordName name="Long original" />);
  const button = screen.getByRole('button', { name: 'Show full name' });
  button.focus();
  overflow = false;
  await act(async () => finish());
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('heading')).toHaveFocus();
  overflow = true;
  view.rerender(<RecordName name="New literal <script> 🔌" />);
  expect(
    screen.getByRole('button', { name: 'Show full name' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('heading')).toHaveTextContent(
    'New literal <script> 🔌',
  );
  expect(document.querySelector('script')).toBeNull();
});
