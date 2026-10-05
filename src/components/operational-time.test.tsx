import { afterEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import * as time from '@/lib/operational-time';
import { MetadataFieldInput } from '@/features/metadata/field-value-input';
import {
  OperationalTimeProvider,
  OperationalTimestamp,
  ExportLink,
} from './operational-time';
afterEach(() => vi.restoreAllMocks());
const at = '2026-10-03T05:23:06.123456Z';
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
