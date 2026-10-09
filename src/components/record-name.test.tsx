import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { RecordName } from './record-name';

it('keeps a long literal name accessible and toggles its visual disclosure without replacing or executing it', async () => {
  const name = 'Cat6 cable '.repeat(16) + '<script>alert(1)</script> 🔌';
  const user = userEvent.setup();
  render(<RecordName name={name} />);
  const heading = screen.getByRole('heading', { name });
  const toggle = screen.getByRole('button', { name: 'Show full name' });
  expect(toggle).toHaveAttribute('aria-controls', heading.id);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('script')).toBeNull();
  toggle.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Show less' })).toHaveFocus();
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('heading', { name })).toBe(heading);
  await user.keyboard(' ');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});
