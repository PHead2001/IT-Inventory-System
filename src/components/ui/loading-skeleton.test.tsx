import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoadingReveal, LoadingSkeleton } from './loading-skeleton';

beforeEach(() => {
  localStorage.removeItem('it-inventory-reduce-motion');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem('it-inventory-reduce-motion');
});

it('server renders static decorative placeholders with one nonvisual polite status', () => {
  const markup = renderToString(
    <LoadingSkeleton shape="files" label="Loading files…" />,
  );
  expect(markup).toContain('data-shimmer="false"');
  const { container } = render(
    <LoadingSkeleton shape="files" label="Loading files…" />,
  );
  expect(screen.getByRole('status')).toHaveClass('sr-only');
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  expect(screen.getByRole('status').closest('[aria-busy="true"]')).toBeNull();
  expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  expect(container.querySelector('button, input, a')).toBeNull();
});

it('responds immediately to local and system reduced motion and pauses hidden-tab shimmer', () => {
  let matches = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  const { container } = render(<LoadingSkeleton label="Loading records…" />);
  const host = container.firstChild;
  expect(host).toHaveAttribute('data-shimmer', 'true');
  act(() => {
    localStorage.setItem('it-inventory-reduce-motion', 'true');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
  });
  expect(host).toHaveAttribute('data-shimmer', 'false');
  act(() => {
    localStorage.setItem('it-inventory-reduce-motion', 'false');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
    matches = true;
    listeners.forEach((listener) => listener());
  });
  expect(host).toHaveAttribute('data-shimmer', 'false');
  act(() => {
    matches = false;
    listeners.forEach((listener) => listener());
  });
  expect(host).toHaveAttribute('data-shimmer', 'true');
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(host).toHaveAttribute('data-active', 'false');
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(host).toHaveAttribute('data-active', 'true');
});

it('fades only a resolved wait while preserving mounted content and keyboard focus', () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const { rerender, unmount } = render(
      <LoadingReveal busy>
        <input aria-label="Retained input" defaultValue="Draft" />
      </LoadingReveal>,
    );
    const input = screen.getByLabelText('Retained input');
    input.focus();
    expect(animate).not.toHaveBeenCalled();
    rerender(
      <LoadingReveal busy={false}>
        <input aria-label="Retained input" defaultValue="Draft" />
      </LoadingReveal>,
    );
    expect(screen.getByLabelText('Retained input')).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Draft');
    expect(animate).toHaveBeenCalledOnce();
    act(() => {
      localStorage.setItem('it-inventory-reduce-motion', 'true');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
      );
    });
    expect(cancel).toHaveBeenCalled();
    rerender(
      <LoadingReveal busy>
        <input aria-label="Retained input" />
      </LoadingReveal>,
    );
    rerender(
      <LoadingReveal busy={false}>
        <input aria-label="Retained input" />
      </LoadingReveal>,
    );
    expect(animate).toHaveBeenCalledOnce();
    unmount();
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it('shows an error immediately without a content fade', () => {
  const original = HTMLElement.prototype.animate;
  const animate = vi.fn();
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const { rerender } = render(
      <LoadingReveal busy>
        <p>Pending</p>
      </LoadingReveal>,
    );
    rerender(
      <LoadingReveal busy={false} reveal={false}>
        <p role="alert">Read failed</p>
      </LoadingReveal>,
    );
    expect(screen.getByRole('alert')).toBeVisible();
    expect(animate).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it('cancels reveal on page hiding and never starts or replays a hidden-page reveal', () => {
  const original = HTMLElement.prototype.animate;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  try {
    const content = (busy: boolean) => (
      <LoadingReveal busy={busy}>
        <p>Current content</p>
      </LoadingReveal>
    );
    const view = render(content(true));
    view.rerender(content(false));
    expect(animate).toHaveBeenCalledOnce();
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(cancel).toHaveBeenCalled();
    view.rerender(content(true));
    view.rerender(content(false));
    expect(animate).toHaveBeenCalledOnce();
    visibility.mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(animate).toHaveBeenCalledOnce();
    view.unmount();
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it('keeps one announcement outside busy content through successful and failed waits', () => {
  const { rerender } = render(
    <LoadingReveal busy announcement="Loading records…">
      <LoadingSkeleton announce={false} label="Loading records…" />
    </LoadingReveal>,
  );
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('Loading records…');
  expect(status.closest('[aria-busy="true"]')).toBeNull();
  rerender(
    <LoadingReveal busy={false} announcement="Loading records…">
      <p>Actual record</p>
    </LoadingReveal>,
  );
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toBeEmptyDOMElement();
  rerender(
    <LoadingReveal busy announcement="Loading records…">
      <LoadingSkeleton announce={false} label="Loading records…" />
    </LoadingReveal>,
  );
  expect(screen.getAllByRole('status')).toEqual([status]);
  expect(status.closest('[aria-busy="true"]')).toBeNull();
  rerender(
    <LoadingReveal busy={false} reveal={false} announcement="Loading records…">
      <p role="alert">Read failed</p>
    </LoadingReveal>,
  );
  expect(screen.getByRole('status')).toBe(status);
  expect(status).toBeEmptyDOMElement();
  expect(screen.getByRole('alert').closest('[aria-busy="true"]')).toBeNull();
});
