import { act, render, screen, waitFor } from '@testing-library/react';
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

it('combines OS and local choices and responds to either changing', async () => {
  const user = userEvent.setup();
  const setSystem = mockSystemMotion();
  render(
    <MotionPreference>
      <Probe />
      <MotionToggle />
    </MotionPreference>,
  );
  const toggle = screen.getByRole('button', { name: 'Reduce motion' });
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('false');
  act(() => setSystem(true));
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
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
  const toggle = screen.getByRole('button', { name: 'Reduce motion' });
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  first.unmount();
  render(
    <MotionPreference>
      <p>Workspace</p>
      <Probe />
      <MotionToggle />
    </MotionPreference>,
  );
  expect(screen.getByRole('button', { name: 'Reduce motion' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
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
  const toggle = screen.getByRole('button', { name: 'Reduce motion' });
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(document.documentElement.dataset.motion).toBe('reduced');
  expect(screen.getByTestId('effective-motion')).toHaveTextContent('true');
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
});
