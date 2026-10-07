import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { CustodyReceipt } from './contracts';
import { CustodyReceiptView } from './custody-receipt';

const receipt: CustodyReceipt = {
  eventId: '00000000-0000-4000-8000-000000000001',
  operation: 'corrected',
  actorName: 'Recorded staff',
  createdAt: '2026-10-07T12:00:00Z',
  quantity: 5,
  source: { id: 'site', kind: 'site', name: 'Recorded site name' },
  destination: null,
  reference: null,
  reason: 'Counted on site',
};

it.each([
  { before: 10, delta: 5, after: 15, adjustment: '+5 units' },
  { before: 10, delta: -5, after: 5, adjustment: '-5 units' },
  { before: 5, delta: -5, after: 0, adjustment: '-5 units' },
])(
  'renders an observed count and signed adjustment at the site: $delta',
  (line) => {
    render(
      <CustodyReceiptView
        receipt={{ ...receipt, source: { ...receipt.source!, ...line } }}
      />,
    );
    const view = screen.getByRole('region', {
      name: 'Committed custody receipt',
    });
    expect(view).toHaveTextContent('Count correction at Recorded site name');
    expect(
      screen.getByText('Count before correction').nextElementSibling,
    ).toHaveTextContent(`${line.before} units`);
    expect(
      screen.getByText('Signed adjustment').nextElementSibling,
    ).toHaveTextContent(line.adjustment);
    expect(
      screen.getByText('Observed count after correction').nextElementSibling,
    ).toHaveTextContent(`${line.after} units`);
    expect(view).not.toHaveTextContent('→');
    expect(view).not.toHaveTextContent('No destination');
  },
);

it('keeps older receipts readable without inventing correction details from the unsigned amount', () => {
  render(
    <CustodyReceiptView
      receipt={{ ...receipt, source: { ...receipt.source!, after: 15 } }}
    />,
  );
  const view = screen.getByRole('region', {
    name: 'Committed custody receipt',
  });
  expect(view).toHaveTextContent('Count correction at Recorded site name');
  expect(view).toHaveTextContent(
    'Correction count details are unavailable in this receipt.',
  );
  expect(view).not.toHaveTextContent('+5');
  expect(view).not.toHaveTextContent('→');
  expect(view).not.toHaveTextContent('No destination');
});

it.each(['issued', 'returned', 'transferred'])(
  'preserves %s movement quantities and endpoint balances',
  (operation) => {
    render(
      <CustodyReceiptView
        receipt={{
          ...receipt,
          operation,
          source: { ...receipt.source!, after: 0 },
          destination: {
            id: 'other',
            kind: 'site',
            name: 'Destination',
            after: 5,
          },
        }}
      />,
    );
    const view = screen.getByRole('region', {
      name: 'Committed custody receipt',
    });
    expect(view).toHaveTextContent(
      '5 units · Recorded site name → Destination',
    );
    expect(
      screen.getByText('Recorded site name · remaining after this operation')
        .nextElementSibling,
    ).toHaveTextContent('0 units');
    expect(
      screen.getByText('Destination · balance after this operation')
        .nextElementSibling,
    ).toHaveTextContent('5 units');
  },
);

it('preserves individual asset site-correction endpoints', () => {
  render(
    <CustodyReceiptView
      receipt={{
        ...receipt,
        quantity: null,
        destination: { id: 'other', kind: 'site', name: 'Corrected site' },
      }}
    />,
  );
  expect(
    screen.getByRole('region', { name: 'Committed custody receipt' }),
  ).toHaveTextContent(
    '1 individual asset · Recorded site name → Corrected site',
  );
});
