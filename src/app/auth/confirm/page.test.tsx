import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@/components/auth/auth-form', () => ({
  AuthForm: () => <form aria-label="Confirm email" />,
}));
import * as route from './page';
it.each(['invite', 'recovery', 'invalid'])(
  'identifies the confirmation task without copying %s token parameters into metadata',
  async (type) => {
    const token = 'PRIVATE_CONFIRMATION_TOKEN';
    render(
      await route.default({
        searchParams: Promise.resolve({ type, token_hash: token }),
      }),
    );
    expect(
      screen.getByRole('heading', { name: 'Confirm your email link' }),
    ).toBeVisible();
    expect(route.metadata.title).toBe('Confirm email link');
    expect(JSON.stringify(route.metadata)).not.toContain(token);
    if (type === 'invalid')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This link is invalid',
      );
    else
      expect(
        screen.getByRole('form', { name: 'Confirm email' }),
      ).toBeInTheDocument();
  },
);
