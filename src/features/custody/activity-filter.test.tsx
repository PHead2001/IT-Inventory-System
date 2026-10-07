import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ActivityFilter } from './activity-filter';
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
beforeEach(() => {
  push.mockReset();
});
afterEach(() => vi.useRealTimers());
it('keeps invalid values and associates range guidance with Until without navigating', () => {
  render(
    <ActivityFilter
      base="/sites/HQ"
      filters={{
        from: '2026-10-08T00:00',
        until: '2026-10-07T00:00',
        q: 'cable',
      }}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Filter activity' }));
  expect(push).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText('Until (UTC, exclusive)'),
  ).toHaveAccessibleDescription(/Until must be later/);
  expect(screen.getByLabelText('From (UTC, inclusive)')).toHaveValue(
    '2026-10-08T00:00',
  );
  fireEvent.change(screen.getByLabelText('Until (UTC, exclusive)'), {
    target: { value: '2026-10-09T00:00' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Filter activity' }));
  expect(push).toHaveBeenCalledOnce();
  const url = new URL(push.mock.calls[0][0], 'https://test.invalid');
  expect(url.searchParams.get('q')).toBe('cable');
  expect(url.searchParams.get('until')).toBe('2026-10-09T00:00:00.000Z');
});
it('resolves a preset once on Apply and leaves an existing explicit range Custom on reload', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T18:00:00Z'));
  const view = render(
    <ActivityFilter
      base="/sites/HQ"
      filters={{ zone: 'America/Chicago', q: 'switch', kind: 'asset' }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Activity range'), {
    target: { value: 'today' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Filter activity' }));
  const url = new URL(push.mock.calls[0][0], 'https://test.invalid');
  expect(url.searchParams.get('from')).toBe('2026-11-01T05:00:00.000Z');
  expect(url.searchParams.get('until')).toBe('2026-11-02T06:00:00.000Z');
  expect(url.searchParams.has('preset')).toBe(false);
  view.unmount();
  vi.setSystemTime(new Date('2026-11-03T18:00:00Z'));
  render(
    <ActivityFilter
      base="/sites/HQ"
      filters={Object.fromEntries(url.searchParams)}
    />,
  );
  expect(screen.getByLabelText('Activity range')).toHaveValue('custom');
  expect(screen.getByLabelText('From (UTC, inclusive)')).toHaveValue(
    '2026-11-01T05:00:00.000Z',
  );
});
