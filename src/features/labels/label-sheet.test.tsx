import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
vi.mock('qrcode', () => ({
  default: { toDataURL: async () => 'data:image/png;base64,iVBORw0KGgo=' },
}));
import { LabelSheet, barcodePayload, printExcerpt } from './label-sheet';

it('keeps quantity identity as the canonical QR URL even when Code 128 is selected', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  const quantity = {
    kind: 'quantity' as const,
    key: id,
    name: 'Cables',
    context: 'Cables',
    path: '/inventory/quantity/' + id,
    state: 'active',
  };
  expect(barcodePayload(quantity)).toBeNull();
  render(
    <LabelSheet
      records={[quantity, quantity]}
      origin="https://inventory.example.test"
      preview={false}
      size="90x50"
      page="letter"
      format="code128"
    />,
  );
  await waitFor(() =>
    expect(
      document.querySelectorAll('.label-card[data-code-ready="true"]'),
    ).toHaveLength(2),
  );
  expect(
    screen.getAllByRole('img', { name: 'QR code for Cables' }),
  ).toHaveLength(2);
  expect(document.querySelectorAll('.label-card')).toHaveLength(2);
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  expect(document.querySelector('style')?.textContent).toContain(
    '.label-print-root:not([data-print-authorized="true"]) { display: none !important; }',
  );
});

it('shortens display text visibly while preserving the full stable identifier', () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  const name = 'Very long asset name '.repeat(12);
  render(
    <LabelSheet
      records={[
        {
          kind: 'asset',
          key: id,
          name,
          context: 'IT Closet / Shelf 1A',
          path: '/inventory/assets/' + id,
          state: 'active',
        },
      ]}
      origin="https://inventory.example.test"
      preview
      size="70x35"
      page="letter"
      format="qr"
    />,
  );
  expect(screen.getByText(id)).toBeInTheDocument();
  expect(screen.getByText(printExcerpt(name, 30))).toHaveTextContent('…');
  expect(
    document.querySelector('.label-card')?.getAttribute('style'),
  ).toContain('width: 70mm');
  expect(
    document.querySelector('.label-card')?.getAttribute('style'),
  ).toContain('height: 35mm');
});

it('scales Code 128 bars and quiet zones at physical module width', async () => {
  render(
    <LabelSheet
      records={[
        {
          kind: 'location',
          key: 'ITC',
          name: 'IT Closet',
          context: 'IT Closet',
          path: '/locations/ITC',
          state: 'active',
        },
      ]}
      origin="https://inventory.example.test"
      preview
      size="90x50"
      page="letter"
      format="code128"
    />,
  );
  const svg = screen.getByRole('img', { name: 'Code 128 LOC:ITC' });
  await waitFor(() => expect(svg).not.toHaveClass('hidden'));
  const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
  expect(viewBox).toHaveLength(4);
  expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  expect(Number.parseFloat(svg.getAttribute('width') ?? '')).toBe(viewBox[2]);
  expect(
    Number.parseFloat(
      svg.getAttribute('style')?.match(/width:\s*([0-9.]+)mm/)?.[1] ?? '',
    ),
  ).toBeCloseTo(viewBox[2] * 0.3);
  expect(viewBox[2]).toBeGreaterThan(20); // internal quiet zones flank actual bars
});
