import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { BuildInfo } from './build-info';
it('discloses full commit and exact timestamp through the native support disclosure', async () => {
  const commit = 'a'.repeat(40);
  const time = '2026-10-09T12:30:00.000Z';
  render(
    <BuildInfo
      provenance={{
        environment: 'Audit staging',
        version: '0.1.0',
        commit,
        buildStarted: time,
      }}
    />,
  );
  expect(
    screen.getByRole('region', { name: 'Build & environment' }),
  ).toHaveTextContent('Audit staging · Version 0.1.0');
  const control = screen.getByText('Build support details');
  await userEvent.click(control);
  expect(control.closest('details')).toHaveAttribute('open');
  expect(screen.getByText(commit)).toBeVisible();
  expect(screen.getByText('Fri, 09 Oct 2026 12:30:00 GMT')).toHaveAttribute(
    'datetime',
    time,
  );
});
it('states unavailable development identity explicitly', () => {
  render(
    <BuildInfo
      provenance={{
        environment: 'Development',
        version: '0.1.0',
        commit: null,
        buildStarted: null,
      }}
    />,
  );
  expect(screen.getByText('Unavailable')).toBeInTheDocument();
  expect(screen.getByText('Unavailable in development')).toBeInTheDocument();
});
