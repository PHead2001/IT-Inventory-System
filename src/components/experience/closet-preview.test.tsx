import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ClosetPreview } from './closet-preview';

it('shows measured rack, shelves and drawers as three-face boxes', () => {
  const { container } = render(<ClosetPreview />);
  expect(
    screen.getByRole('img', { name: 'IT closet spatial preview' }),
  ).toBeVisible();
  expect(container.querySelectorAll('[data-fixture^="shelf-"]')).toHaveLength(
    12,
  );
  expect(container.querySelectorAll('[data-fixture^="drawer-"]')).toHaveLength(
    12,
  );
  expect(
    container.querySelectorAll('[data-fixture="server-rack"]'),
  ).toHaveLength(1);
  expect(container.querySelectorAll('[data-fixture] polygon')).toHaveLength(75);
});
