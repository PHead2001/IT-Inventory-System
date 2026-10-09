import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import * as time from '@/lib/operational-time';
import { relativeClockSnapshot } from '@/lib/relative-clock';
import { MetadataFieldInput } from '@/features/metadata/field-value-input';
import {
  OperationalTimeProvider,
  OperationalTimestamp,
  ExportLink,
} from './operational-time';
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const at = '2026-10-03T05:23:06.123456Z';
it('updates every mounted timestamp for a new event, shared ticks and visibility resume while preserving recorded instants', () => {
  vi.useFakeTimers();
  const visibility = vi
    .spyOn(document, 'visibilityState', 'get')
    .mockReturnValue('visible');
  vi.setSystemTime(new Date('2026-10-03T05:23:56Z'));
  const original = '2026-10-03T05:23:06Z';
  const saved = '2026-10-03T05:24:16.123456Z';
  const view = (added: boolean) => (
    <>
      <OperationalTimestamp key="original" value={original} relative />
      {added && <OperationalTimestamp key="saved" value={saved} relative />}
    </>
  );
  const { container, rerender, unmount } = render(view(false));
  expect(container.querySelector('time')).toHaveTextContent('Just now');
  // No timer tick: mounting a new event must refresh the shared cached instant.
  vi.setSystemTime(new Date('2026-10-03T05:24:16Z'));
  rerender(view(true));
  const timestamps = () => [...container.querySelectorAll('time')];
  expect(timestamps()[0]).toHaveTextContent('1 min ago');
  expect(timestamps()[1]).toHaveTextContent('Just now');
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(60_000));
  expect(timestamps()[1]).toHaveTextContent('Just now'); // source subseconds are retained
  act(() => {
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(180_000);
  });
  expect(vi.getTimerCount()).toBe(0);
  act(() => {
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(timestamps()[1]).toHaveTextContent('3 min ago');
  expect(timestamps()[1]).toHaveAttribute('datetime', saved);
  fireEvent.click(container.querySelectorAll('summary')[1]);
  expect(screen.getByText(saved)).toBeVisible();
  unmount();
  expect(relativeClockSnapshot()).toBeNull();
});
it('hydrates relative history without replacing the server UTC text until subscription', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T05:25:06Z'));
  const view = <OperationalTimestamp value={at} relative />;
  const container = document.createElement('div');
  container.innerHTML = renderToString(view);
  expect(container.querySelector('time')).toHaveTextContent(
    '3 Oct 2026, 05:23:06 UTC',
  );
  document.body.append(container);
  const recoverable = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, view, { onRecoverableError: recoverable });
  });
  expect(container.querySelector('time')).toHaveTextContent('1 min ago');
  expect(recoverable).not.toHaveBeenCalled();
  await act(async () => root!.unmount());
  container.remove();
  vi.useRealTimers();
});
it('discloses the exact timestamp, timezone and recorded precision through a focusable control', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T05:25:06Z'));
  const { container, unmount } = render(
    <OperationalTimestamp value={at} relative />,
  );
  const summary = container.querySelector('summary')!;
  expect(summary).toHaveTextContent('1 min ago');
  expect(summary).toHaveTextContent('3 Oct 2026, 05:23:06 UTC');
  summary.focus();
  expect(summary).toHaveFocus();
  fireEvent.click(summary);
  expect(screen.getByText(at)).toBeVisible();
  expect(container.querySelector('time')).toHaveAttribute('datetime', at);
  unmount();
  vi.useRealTimers();
});
function Surface() {
  return (
    <OperationalTimeProvider>
      <OperationalTimestamp value={at} />
      <OperationalTimestamp value="2026-11-01T06:30:00Z" />
      <ExportLink href="/api/exports/inventory?q=Cable#csv" download>
        Export
      </ExportLink>
    </OperationalTimeProvider>
  );
}
it('hydrates matching UTC then uses one browser zone across timestamps and export without changing raw values', async () => {
  const resolve = vi
    .spyOn(time, 'browserDisplayTimeZone')
    .mockReturnValue({ timeZone: 'America/Los_Angeles', fallback: false });
  const recoverable = vi.fn();
  const container = document.createElement('div');
  container.innerHTML = renderToString(<Surface />);
  expect(container.textContent).toContain('3 Oct 2026, 05:23:06 UTC');
  expect(resolve).not.toHaveBeenCalled();
  document.body.append(container);
  let root: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => {
      root = hydrateRoot(container, <Surface />, {
        onRecoverableError: recoverable,
      });
    });
    expect(container.textContent).toContain(
      '2 Oct 2026, 22:23:06 UTC-07:00 (America/Los_Angeles)',
    );
    expect(container.querySelector('time')).toHaveAttribute('datetime', at);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/api/exports/inventory?q=Cable&displayTimeZone=America%2FLos_Angeles#csv',
    );
    expect(container.querySelector('a')).toHaveAttribute('download');
    expect(resolve).toHaveBeenCalledOnce();
    expect(recoverable).not.toHaveBeenCalled();
  } finally {
    await act(async () => root!.unmount());
    container.remove();
  }
});
it('labels unavailable browser-zone fallback and unavailable timestamps without epoch or current time', () => {
  vi.spyOn(time, 'browserDisplayTimeZone').mockReturnValue({
    timeZone: 'UTC',
    fallback: true,
  });
  render(
    <OperationalTimeProvider>
      <OperationalTimestamp value={at} />
      <OperationalTimestamp value={null} />
      <OperationalTimestamp value="bad" />
      <ExportLink href="/api/exports/inventory?q=Cable&displayTimeZone=America%2FNew_York#csv">
        Export
      </ExportLink>
    </OperationalTimeProvider>,
  );
  expect(
    screen.getByText('3 Oct 2026, 05:23:06 UTC (UTC fallback)'),
  ).toBeVisible();
  expect(screen.getAllByText('Time unavailable')).toHaveLength(2);
  expect(document.querySelectorAll('time')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Export' })).toHaveAttribute(
    'href',
    '/api/exports/inventory?q=Cable#csv',
  );
});
it('leaves actual date-only metadata controls unchanged when the operational display zone changes', () => {
  const resolve = vi
    .spyOn(time, 'browserDisplayTimeZone')
    .mockReturnValue({ timeZone: 'Pacific/Kiritimati', fallback: false });
  const changed = vi.fn();
  const ui = (key: string) => (
    <OperationalTimeProvider key={key}>
      <OperationalTimestamp value="2024-02-29T12:00:00Z" />
      <MetadataFieldInput
        field={{
          id: 'date',
          type: 'date',
          label: 'Calendar date',
          help: '',
          required: false,
          applies_to: ['quantity'],
          rules: {},
          options: [],
        }}
        value="2024-02-29"
        onChange={changed}
      />
    </OperationalTimeProvider>
  );
  const { rerender } = render(ui('east'));
  expect(screen.getByDisplayValue('2024-02-29')).toHaveAttribute(
    'type',
    'date',
  );
  expect(screen.getByText(/1 Mar 2024/)).toBeVisible();
  resolve.mockReturnValue({ timeZone: 'America/Los_Angeles', fallback: false });
  rerender(ui('west'));
  expect(screen.getByDisplayValue('2024-02-29')).toHaveValue('2024-02-29');
  expect(screen.getByText(/29 Feb 2024/)).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
});
