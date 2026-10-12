import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ScanMatchLabel } from './scan-match-label';

it('composes name and literal identifier independently without parsing punctuation or changing target identity', () => {
  const match = {
    kind: 'asset' as const,
    path: '/inventory/assets/immutable-id',
    state: 'active' as const,
    name: 'Laptop (old tag: FAKE) <script>',
    identifier: 'Tag-0O-1l/🔌',
    label: 'Laptop (old tag: FAKE) <script> (Tag-0O-1l/🔌)',
  };
  const snapshot = structuredClone(match);
  const { container } = render(
    <button>
      <ScanMatchLabel match={match} />
    </button>,
  );
  expect(screen.getByRole('button')).toHaveTextContent(match.label);
  expect(container.querySelector('span')).toHaveTextContent(match.identifier);
  expect(container.querySelector('script')).toBeNull();
  expect(match).toEqual(snapshot);
});
it('keeps a legacy combined label intact when structured display fields are absent', () => {
  render(
    <button>
      <ScanMatchLabel
        match={{
          kind: 'quantity',
          path: '/inventory/quantity/id',
          state: 'archived',
          label: 'Name (parentheses) /SKU',
        }}
      />
    </button>,
  );
  expect(screen.getByRole('button')).toHaveTextContent(
    'Name (parentheses) /SKU',
  );
  expect(screen.getByRole('button').querySelector('span')).toBeNull();
});
