import { act, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import {
  MotionPreference,
  MotionToggle,
  useEffectiveReducedMotion,
} from './motion-preference';

function Probe() {
  return (
    <output data-testid="effective-motion">
      {String(useEffectiveReducedMotion())}
    </output>
  );
}

function mockSystemMotion(initial = false) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const media = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      listeners.delete(listener),
  } as unknown as MediaQueryList;
  vi.stubGlobal('matchMedia', () => media);
  return (next: boolean) => {
    matches = next;
    listeners.forEach((listener) => listener());
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.removeItem('it-inventory-reduce-motion');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
  );
  delete document.documentElement.dataset.motion;
});

it('server-renders reduced motion and releases it only after hydrating a normal preference', async () => {
  mockSystemMotion(false);
  window.localStorage.setItem('it-inventory-reduce-motion', 'false');
  const view = (
    <MotionPreference>
      <Probe />
    </MotionPreference>
  );
  const markup = renderToString(view);
  expect(markup).toContain('data-testid="effective-motion">true</output>');
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.appendChild(container);
  document.documentElement.dataset.motion = 'reduced';
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, view);
  });
  await waitFor(() => {
    expect(container.querySelector('output')).toHaveTextContent('false');
    expect(document.documentElement.dataset.motion).toBe('full');
  });
  await act(async () => root?.unmount());
  container.remove();
});

it('keeps persisted local reduction during hydration when OS motion is normal', async () => {
  mockSystemMotion(false);
  window.localStorage.setItem('it-inventory-reduce-motion', 'true');
  const view = (
    <MotionPreference>
      <Probe />
    </MotionPreference>
  );
  const markup = renderToString(view);
  expect(markup).toContain('data-testid="effective-motion">true</output>');
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.appendChild(container);
  document.documentElement.dataset.motion = 'reduced';
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, view);
  });
  expect(container.querySelector('output')).toHaveTextContent('true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  await act(async () => root?.unmount());
  container.remove();
});

it.each([false, true])(
  'keeps the preference unknown until the saved browser choice (%s) is known, then exposes and toggles that choice',
  async (saved) => {
    mockSystemMotion(false);
    window.localStorage.setItem('it-inventory-reduce-motion', String(saved));
    const view = (
      <MotionPreference>
        <MotionToggle />
      </MotionPreference>
    );
    const container = document.createElement('div');
    container.innerHTML = renderToString(view);
    document.body.appendChild(container);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      const toggle = within(container).getByRole('button', {
        name: 'Reduce motion in this browser',
      });
      expect(toggle).toBeDisabled();
      expect(toggle).not.toHaveAttribute('role');
      expect(toggle).not.toHaveAttribute('aria-checked');
      expect(within(container).queryByRole('switch')).not.toBeInTheDocument();
      expect(toggle).toHaveAccessibleDescription(
        "Loading this browser's motion preference.",
      );
      await act(async () => {
        root = hydrateRoot(container, view);
      });
      await waitFor(() => {
        expect(
          within(container).getByRole('switch', {
            name: 'Reduce motion in this browser',
          }),
        ).toBe(toggle);
        expect(toggle).toBeEnabled();
        expect(toggle).toHaveAttribute('aria-checked', String(saved));
      });
      await userEvent.setup().click(toggle);
      expect(toggle).toHaveAttribute('aria-checked', String(!saved));
      expect(window.localStorage.getItem('it-inventory-reduce-motion')).toBe(
        String(!saved),
      );
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  },
);

it('combines OS and local choices and responds to either changing', async () => {
  const user = userEvent.setup();
  const setSystem = mockSystemMotion();
  render(
    <MotionPreference>
      <Probe />
      <MotionToggle />
    </MotionPreference>,
  );
  const toggle = screen.getByRole('switch', {
    name: 'Reduce motion in this browser',
  });
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('false');
  expect(toggle).toHaveAccessibleDescription('Full motion is active.');
  expect(toggle).toHaveAttribute('aria-checked', 'false');
  act(() => setSystem(true));
  expect(toggle).toHaveAccessibleDescription(
    'Reduced motion is required by your system, even when this switch is off.',
  );
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(toggle).toHaveAccessibleDescription(
    'Reduced motion is active. Your system also requires reduced motion.',
  );
  act(() => setSystem(false));
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('true');
  await user.click(toggle);
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('false');
  expect(document.documentElement.dataset.motion).toBe('full');
});

it('updates from another tab while honoring the OS setting', () => {
  const setSystem = mockSystemMotion(true);
  render(
    <MotionPreference>
      <Probe />
      <MotionToggle />
    </MotionPreference>,
  );
  act(() => {
    window.localStorage.setItem('it-inventory-reduce-motion', 'true');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
    setSystem(false);
  });
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('true');
  act(() => {
    window.localStorage.setItem('it-inventory-reduce-motion', 'false');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
  });
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('false');
});

it('keeps the local reduced-motion choice across mounts', async () => {
  const user = userEvent.setup();
  const first = render(
    <MotionPreference>
      <p>Workspace</p>
      <MotionToggle />
    </MotionPreference>,
  );
  const toggle = screen.getByRole('switch', {
    name: 'Reduce motion in this browser',
  });
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  first.unmount();
  render(
    <MotionPreference>
      <p>Workspace</p>
      <Probe />
      <MotionToggle />
    </MotionPreference>,
  );
  expect(
    screen.getByRole('switch', { name: 'Reduce motion in this browser' }),
  ).toHaveAttribute('aria-checked', 'true');
});

it('renders and toggles when browser storage rejects reads and writes', async () => {
  const user = userEvent.setup();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage blocked', 'SecurityError');
  });

  render(
    <MotionPreference>
      <p>Workspace</p>
      <Probe />
      <MotionToggle />
    </MotionPreference>,
  );
  expect(screen.getByText('Workspace')).toBeInTheDocument();
  const toggle = screen.getByRole('switch', {
    name: 'Reduce motion in this browser',
  });
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('true');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-checked', 'false');
});
