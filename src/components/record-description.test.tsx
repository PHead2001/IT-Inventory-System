import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { RecordDescription, RecordTextDisclosure } from './record-description';

const motionState = vi.hoisted(() => ({
  reduced: false,
  height: '',
  duration: 0,
  running: false,
  commands: [] as Array<{ kind: 'stop' | 'set' | 'start'; height?: string }>,
}));
let naturalHeight = 24;
let width = 280;
let fonts: EventTarget & { ready: Promise<void> };
const observers = new Set<() => void>();
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => motionState.reduced,
}));
vi.mock('motion/react', async () => {
  const { useRef } = await import('react');
  return {
    useAnimationControls: () => {
      const controls = useRef({
        stop() {
          motionState.running = false;
          motionState.commands.push({ kind: 'stop' });
        },
        set(definition: { height: string }) {
          motionState.height = definition.height;
          motionState.duration = 0;
          motionState.running = false;
          motionState.commands.push({ kind: 'set', height: definition.height });
        },
        start(definition: {
          height: string;
          transition: { duration: number };
        }) {
          motionState.height = definition.height;
          motionState.duration = definition.transition.duration;
          motionState.running = true;
          motionState.commands.push({
            kind: 'start',
            height: definition.height,
          });
          return Promise.resolve();
        },
      });
      return controls.current;
    },
    motion: {
      div: ({
        children,
        initial,
        animate,
        ...props
      }: {
        children: ReactNode;
        initial: boolean;
        animate: unknown;
      }) => {
        expect(initial).toBe(false);
        expect(animate).toBeDefined();
        return <div {...props}>{children}</div>;
      },
    },
  };
});
beforeEach(() => {
  motionState.reduced = false;
  motionState.running = false;
  motionState.commands.length = 0;
  naturalHeight = 24;
  width = 280;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    () => width,
  );
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    () => width,
  );
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(
    () => naturalHeight,
  );
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    (element) =>
      new Proxy(computed(element), {
        get: (target, key) =>
          key === 'lineHeight'
            ? '24px'
            : key === 'fontSize'
              ? '16px'
              : Reflect.get(target, key, target),
      }),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.add(callback);
      }
      observe() {}
      disconnect() {
        observers.delete(this.callback);
      }
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
  observers.clear();
  Reflect.deleteProperty(document, 'fonts');
});

it('shows fitting text completely without a no-op control regardless of character count', () => {
  const text = 'A'.repeat(180);
  render(<RecordDescription description={text} />);
  expect(screen.queryByRole('button')).toBeNull();
  expect(motionState.height).toBe('auto');
  expect(screen.getByText(text).textContent).toBe(text);
});

it('bounds fewer than 180 characters that wrap beyond three lines', () => {
  naturalHeight = 120;
  const text =
    'A short note that wraps across several lines on a narrow phone.';
  expect(text.length).toBeLessThan(180);
  render(<RecordDescription description={text} />);
  const toggle = screen.getByRole('button', { name: 'Show full description' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(
    document.getElementById(toggle.getAttribute('aria-controls')!)!.textContent,
  ).toBe(text);
  expect(motionState.height).not.toBe('auto');
  const content = document.getElementById(
    toggle.getAttribute('aria-controls')!,
  )!;
  expect(content.parentElement!.style.height).toBe(motionState.height);
  expect(motionState.commands.some((command) => command.kind === 'start')).toBe(
    false,
  );
});

it.each([false, true])(
  'retains the real paragraph and keyboard focus through height disclosure (Reduced=%s)',
  async (reduced) => {
    motionState.reduced = reduced;
    naturalHeight = 240;
    const user = userEvent.setup();
    const text = 'Recorded description.\n'.repeat(100) + 'Final sentence.';
    render(<RecordDescription description={text} />);
    const toggle = screen.getByRole('button', {
      name: 'Show full description',
    });
    const content = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    )!;
    expect(content.textContent).toBe(text);
    expect(motionState.height).not.toBe('auto');
    expect(
      motionState.commands.some((command) => command.kind === 'start'),
    ).toBe(false);
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(motionState.height).toBe('auto');
    expect(motionState.duration).toBe(reduced ? 0 : 0.22);
    expect(document.getElementById(content.id)).toBe(content);
    await user.keyboard(' ');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(motionState.height).not.toBe('auto');
    expect(content.textContent).toBe(text);
    expect(document.querySelectorAll('p')).toHaveLength(1);
  },
);

it('remeasures viewport/font changes and keeps an expanded focused toggle after text starts fitting', async () => {
  const user = userEvent.setup();
  render(<RecordDescription description="A note with responsive wrapping." />);
  expect(screen.queryByRole('button')).toBeNull();
  naturalHeight = 96;
  act(() => {
    window.dispatchEvent(new Event('resize'));
  });
  const toggle = screen.getByRole('button', { name: 'Show full description' });
  toggle.focus();
  await user.keyboard('{Enter}');
  const paragraph = document.getElementById(
    toggle.getAttribute('aria-controls')!,
  )!;
  naturalHeight = 24;
  width = 1000;
  act(() => {
    for (const observe of observers) observe();
    fonts.dispatchEvent(new Event('loadingdone'));
  });
  expect(screen.getByRole('button', { name: 'Show less description' })).toBe(
    toggle,
  );
  expect(toggle).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await user.keyboard(' ');
  expect(screen.queryByRole('button')).toBeNull();
  expect(paragraph).toHaveFocus();
  expect(document.querySelectorAll('p')).toHaveLength(1);
});

it('bounds both maximum-length manufacturer/model values and preserves every character on expansion', async () => {
  naturalHeight = 240;
  const user = userEvent.setup();
  const text = `Manufacturer: ${'M'.repeat(200)} · Model: ${'N'.repeat(200)}`;
  render(
    <RecordTextDisclosure
      text={text}
      label="manufacturer and model"
      lines={1}
    />,
  );
  const toggle = screen.getByRole('button', {
    name: 'Show full manufacturer and model',
  });
  const paragraph = document.getElementById(
    toggle.getAttribute('aria-controls')!,
  )!;
  expect(paragraph.textContent).toBe(text);
  expect(motionState.height).not.toBe('auto');
  await user.click(toggle);
  expect(motionState.height).toBe('auto');
  expect(paragraph.textContent).toBe(text);
  expect(
    screen.getByRole('button', { name: 'Show less manufacturer and model' }),
  ).toBe(toggle);
});

it.each(['expand', 'collapse'] as const)(
  'stops and sets an already-running %s when Reduced changes with the same target',
  async (direction) => {
    naturalHeight = 240;
    const user = userEvent.setup();
    const view = render(
      <RecordDescription description="A note that wraps into many rendered lines." />,
    );
    expect(
      motionState.commands.some((command) => command.kind === 'start'),
    ).toBe(false);
    const toggle = screen.getByRole('button', {
      name: 'Show full description',
    });
    await user.click(toggle);
    if (direction === 'collapse') await user.click(toggle);
    expect(motionState.running).toBe(true);
    const target = motionState.height;
    const content = document.getElementById(
      toggle.getAttribute('aria-controls')!,
    )!;
    const viewport = content.parentElement!;
    viewport.style.height = '120px'; // Model a real interpolated visual height.
    const before = motionState.commands.length;
    motionState.reduced = true;
    view.rerender(
      <RecordDescription description="A note that wraps into many rendered lines." />,
    );
    expect(motionState.running).toBe(false);
    expect(motionState.height).toBe(target);
    expect(viewport.style.height).toBe(target);
    expect(motionState.commands.slice(before)).toContainEqual({
      kind: 'set',
      height: target,
    });
    expect(
      motionState.commands
        .slice(before)
        .some((command) => command.kind === 'stop'),
    ).toBe(true);
    expect(
      motionState.commands
        .slice(before)
        .some((command) => command.kind === 'start'),
    ).toBe(false);
  },
);
