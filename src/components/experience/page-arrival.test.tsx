import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { PageArrival } from './page-arrival';
import { MotionPreference } from './motion-preference';

const route = vi.hoisted(() => ({ pathname: '/dashboard' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
let mounts = 0;
function PersistentForm() {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <input aria-label="Unsaved note" defaultValue="retain me" />;
}

beforeEach(() => {
  mounts = 0;
  route.pathname = '/dashboard';
});

it('waits for the real client preference before consuming the first hydrated arrival', async () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  const original = Element.prototype.animate;
  Element.prototype.animate =
    animate as unknown as typeof Element.prototype.animate;
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  window.localStorage.setItem('it-inventory-reduce-motion', 'false');
  const view = (
    <MotionPreference>
      <PageArrival>
        <PersistentForm />
      </PageArrival>
    </MotionPreference>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(view);
  document.body.appendChild(container);
  document.documentElement.dataset.motion = 'reduced';
  expect(animate).not.toHaveBeenCalled();
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, view);
    });
    expect(animate).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.motion).toBe('full');
    await act(async () => {
      root?.render(view);
    });
    expect(animate).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    Element.prototype.animate = original;
    vi.unstubAllGlobals();
    window.localStorage.removeItem('it-inventory-reduce-motion');
  }
});

it('keeps the first hydrated arrival static for a real reduced preference', async () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  const original = Element.prototype.animate;
  Element.prototype.animate =
    animate as unknown as typeof Element.prototype.animate;
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const view = (
    <MotionPreference>
      <PageArrival>
        <PersistentForm />
      </PageArrival>
    </MotionPreference>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(view);
  document.body.appendChild(container);
  let root: ReturnType<typeof hydrateRoot> | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, view);
    });
    expect(animate).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.motion).toBe('reduced');
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    Element.prototype.animate = original;
    vi.unstubAllGlobals();
  }
});

it('animates pathname arrival without remounting server children on route or query refresh', () => {
  const animate = vi.fn(() => ({ cancel: vi.fn() }));
  const original = Element.prototype.animate;
  Element.prototype.animate =
    animate as unknown as typeof Element.prototype.animate;
  try {
    const { rerender } = render(
      <PageArrival>
        <PersistentForm />
      </PageArrival>,
    );
    expect(animate).toHaveBeenCalledTimes(1);
    const input = screen.getByRole<HTMLInputElement>('textbox', {
      name: 'Unsaved note',
    });
    input.value = 'draft';
    rerender(
      <PageArrival>
        <PersistentForm />
      </PageArrival>,
    );
    expect(animate).toHaveBeenCalledTimes(1);
    route.pathname = '/inventory';
    rerender(
      <PageArrival>
        <PersistentForm />
      </PageArrival>,
    );
    expect(animate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'Unsaved note' })).toBe(input);
    expect(input).toHaveValue('draft');
    expect(mounts).toBe(1);

    act(() => {
      window.localStorage.setItem('it-inventory-reduce-motion', 'true');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
      );
    });
    expect(animate.mock.results[1].value.cancel).toHaveBeenCalled();
    route.pathname = '/locations';
    rerender(
      <PageArrival>
        <PersistentForm />
      </PageArrival>,
    );
    expect(animate).toHaveBeenCalledTimes(2);
  } finally {
    window.localStorage.removeItem('it-inventory-reduce-motion');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'it-inventory-reduce-motion' }),
    );
    Element.prototype.animate = original;
  }
});
