import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { CopyTechnicalDetails } from './copy-technical-details';
it('preserves support precision and announces clipboard failure without exposing IDs', async () => {
  const details =
    'Operation: 00000000-0000-4000-8000-000000000001\nRecorded instant: 2026-10-09T00:37:38.985043+00:00';
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(new Error('permission denied'))
    .mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const { container } = render(<CopyTechnicalDetails details={details} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy technical details' }),
  );
  expect(await screen.findByRole('status')).toHaveTextContent('Could not copy');
  expect(container.textContent).not.toContain('00000000-');
  expect(container.textContent).not.toContain('985043');
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy technical details' }),
  );
  expect(await screen.findByText('Technical details copied.')).toBeVisible();
  expect(writeText).toHaveBeenLastCalledWith(details);
});
