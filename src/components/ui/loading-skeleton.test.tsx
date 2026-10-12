import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoadingReveal, LoadingSkeleton } from './loading-skeleton';
import { MotionPreference } from '@/components/experience/motion-preference';

beforeEach(() => {
  document.documentElement.dataset.motion = 'full';
  document.documentElement.style.setProperty('--motion-feedback', '130ms');
  document.documentElement.style.setProperty(
    '--ease-workspace',
    'cubic-bezier(0.2, 0.8, 0.2, 1)',
  );
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
  delete document.documentElement.dataset.motion;
  document.documentElement.style.removeProperty('--motion-feedback');
  document.documentElement.style.removeProperty('--ease-workspace');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem('it-inventory-reduce-motion');
});

it.each(['175ms', '.175s', '1.75e-1s'])(
  'reads the live feedback timing and workspace easing at resolution (%s)',
  (duration) => {
    const original = HTMLElement.prototype.animate;
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    try {
      const content = (busy: boolean) => (
        <LoadingReveal busy={busy}>
          <input aria-label="Token draft" defaultValue="Retained" />
        </LoadingReveal>
      );
      const view = render(content(true));
      const input = screen.getByLabelText('Token draft');
      input.focus();
      document.documentElement.style.setProperty('--motion-feedback', duration);
      document.documentElement.style.setProperty('--ease-workspace', 'ease-in');
      view.rerender(content(false));
      expect(animate).toHaveBeenCalledWith(
        [{ opacity: 0.65 }, { opacity: 1 }],
        { duration: 175, easing: 'ease-in' },
      );
      expect(screen.getByLabelText('Token draft')).toBe(input);
      expect(input).toHaveFocus();
      expect(input).toHaveValue('Retained');
    } finally {
      HTMLElement.prototype.animate = original;
    }
  },
);

it.each([
  ['', 'ease-out'],
  ['130', 'ease-out'],
  ['130ms invalid', 'ease-out'],
  ['0ms', 'ease-out'],
  ['-1ms', 'ease-out'],
  ['251ms', 'ease-out'],
  ['1e999s', 'ease-out'],
  ['130ms', ''],
  ['130ms', 'invalid'],
  ['130ms', 'cubic-bezier(2, 0, 0, 1)'],
  ['130ms', 'cubic-bezier(0, 1e999, 0, 1)'],
])('keeps invalid feedback timing %s / %s static', (duration, easing) => {
  document.documentElement.style.setProperty('--motion-feedback', duration);
  document.documentElement.style.setProperty('--ease-workspace', easing);
  const original = HTMLElement.prototype.animate;
  const animate = vi.fn();
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const view = render(
      <LoadingReveal busy>
        <p>Current content</p>
      </LoadingReveal>,
    );
    view.rerender(
      <LoadingReveal busy={false}>
        <p>Current content</p>
      </LoadingReveal>,
    );
    expect(screen.getByText('Current content')).toBeVisible();
    expect(animate).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it('keeps resolved content usable when the browser rejects a reveal animation', () => {
  const original = HTMLElement.prototype.animate;
  const animate = vi.fn(() => {
    throw new TypeError('Unsupported animation timing');
  });
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const view = render(
      <LoadingReveal busy>
        <p>Current content</p>
      </LoadingReveal>,
    );
    expect(() =>
      view.rerender(
        <LoadingReveal busy={false}>
          <p>Current content</p>
        </LoadingReveal>,
      ),
    ).not.toThrow();
    expect(screen.getByText('Current content')).toBeVisible();
  } finally {
    HTMLElement.prototype.animate = original;
  }
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

it('fades only a resolved wait while preserving mounted content and keyboard focus', async () => {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const { rerender, unmount } = render(
      <MotionPreference>
        <LoadingReveal busy>
          <input aria-label="Retained input" defaultValue="Draft" />
        </LoadingReveal>
      </MotionPreference>,
    );
    const input = screen.getByLabelText('Retained input');
    input.focus();
    expect(animate).not.toHaveBeenCalled();
    rerender(
      <MotionPreference>
        <LoadingReveal busy={false}>
          <input aria-label="Retained input" defaultValue="Draft" />
        </LoadingReveal>
      </MotionPreference>,
    );
    expect(screen.getByLabelText('Retained input')).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Draft');
    expect(animate).toHaveBeenCalledOnce();
    await act(async () => {
      localStorage.setItem('it-inventory-reduce-motion', 'true');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
      );
    });
    expect(cancel).toHaveBeenCalled();
    rerender(
      <MotionPreference>
        <LoadingReveal busy>
          <input aria-label="Retained input" />
        </LoadingReveal>
      </MotionPreference>,
    );
    rerender(
      <MotionPreference>
        <LoadingReveal busy={false}>
          <input aria-label="Retained input" />
        </LoadingReveal>
      </MotionPreference>,
    );
    expect(animate).toHaveBeenCalledOnce();
    unmount();
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it('admits motion separately without reading storage or remounting retained children', () => {
  const get = vi.spyOn(Storage.prototype, 'getItem');
  const original = HTMLElement.prototype.animate;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const content = (motionReady: boolean, busy: boolean) => (
      <LoadingReveal motionReady={motionReady} busy={busy}>
        <input aria-label="Scoped draft" defaultValue="Retained" />
      </LoadingReveal>
    );
    const { rerender, unmount } = render(content(false, true));
    const input = screen.getByLabelText('Scoped draft');
    input.focus();
    expect(get).not.toHaveBeenCalled();
    rerender(content(false, false));
    expect(get).not.toHaveBeenCalled();
    rerender(content(true, false));
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Scoped draft')).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Retained');
    rerender(content(true, true));
    rerender(content(true, false));
    expect(animate).toHaveBeenCalledOnce();
    get.mockClear();
    rerender(content(false, false));
    expect(cancel).toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Scoped draft')).toBe(input);
    expect(input).toHaveFocus();
    rerender(content(true, false));
    expect(animate).toHaveBeenCalledOnce();
    rerender(content(true, true));
    rerender(content(true, false));
    const beforeUnmount = cancel.mock.calls.length;
    unmount();
    expect(cancel.mock.calls.length).toBeGreaterThan(beforeUnmount);
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it.each([undefined, 'reduced', 'unknown'])(
  'keeps resolved content static for motion mode %s',
  (mode) => {
    if (mode === undefined) delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = mode;
    const original = HTMLElement.prototype.animate;
    const animate = vi.fn();
    HTMLElement.prototype.animate = animate as unknown as typeof original;
    try {
      const view = render(
        <LoadingReveal busy>
          <p>Current record</p>
        </LoadingReveal>,
      );
      view.rerender(
        <LoadingReveal busy={false}>
          <p>Current record</p>
        </LoadingReveal>,
      );
      expect(screen.getByText('Current record')).toBeVisible();
      expect(animate).not.toHaveBeenCalled();
    } finally {
      HTMLElement.prototype.animate = original;
    }
  },
);

it('cancels a live reveal for system reduced motion without reading preferences from storage', () => {
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
  const original = HTMLElement.prototype.animate;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  const get = vi.spyOn(Storage.prototype, 'getItem');
  try {
    const view = render(
      <LoadingReveal busy>
        <p>Current record</p>
      </LoadingReveal>,
    );
    view.rerender(
      <LoadingReveal busy={false}>
        <p>Current record</p>
      </LoadingReveal>,
    );
    expect(animate).toHaveBeenCalledOnce();
    act(() => {
      matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(cancel).toHaveBeenCalled();
    view.rerender(
      <LoadingReveal busy>
        <p>Current record</p>
      </LoadingReveal>,
    );
    view.rerender(
      <LoadingReveal busy={false}>
        <p>Current record</p>
      </LoadingReveal>,
    );
    expect(animate).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.animate = original;
  }
});

it('cancels an active reveal when the canonical motion mode becomes unknown', async () => {
  const original = HTMLElement.prototype.animate;
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const view = render(
      <LoadingReveal busy>
        <p>Current record</p>
      </LoadingReveal>,
    );
    view.rerender(
      <LoadingReveal busy={false}>
        <p>Current record</p>
      </LoadingReveal>,
    );
    expect(animate).toHaveBeenCalledOnce();
    await act(async () => {
      delete document.documentElement.dataset.motion;
    });
    expect(cancel).toHaveBeenCalled();
    expect(screen.getByText('Current record')).toBeVisible();
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
