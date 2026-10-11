import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CopyTechnicalDetails } from './copy-technical-details';
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  'clipboard',
);
afterEach(() => {
  if (originalClipboard)
    Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});
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

it.each(['unavailable', 'denied'] as const)(
  'offers an explicitly disclosed selectable fallback when the clipboard is %s',
  async (availability) => {
    const details =
      'Operation: 00000000-0000-4000-8000-000000000001\nRecorded instant: 2026-10-09T00:37:38.985043+00:00';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value:
        availability === 'unavailable'
          ? undefined
          : {
              writeText: vi
                .fn()
                .mockRejectedValue(new Error('permission denied')),
            },
    });
    const { container, rerender } = render(
      <CopyTechnicalDetails details={details} />,
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy technical details' }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Could not copy',
    );
    expect(container.textContent).not.toContain('00000000-');
    expect(container.textContent).not.toContain('985043');
    const disclosure = screen.getByRole('button', {
      name: 'Show technical details',
    });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const field = screen.getByRole('textbox', {
      name: 'Technical details for manual copying',
    });
    expect(field).toHaveValue(details);
    expect(field).toHaveAttribute('readonly');
    fireEvent.click(
      screen.getByRole('button', { name: 'Select technical details' }),
    );
    expect(field).toHaveFocus();
    expect((field as HTMLTextAreaElement).selectionStart).toBe(0);
    expect((field as HTMLTextAreaElement).selectionEnd).toBe(details.length);
    rerender(
      <CopyTechnicalDetails details={details + '\nEnvironment: preview'} />,
    );
    expect(field).toHaveValue(details + '\nEnvironment: preview');
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide technical details' }),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.textContent).not.toContain('00000000-');
  },
);
