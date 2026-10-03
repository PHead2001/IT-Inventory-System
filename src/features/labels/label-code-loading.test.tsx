import { render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const engines = vi.hoisted(() => ({ qr: vi.fn(), barcode: vi.fn() }));
vi.mock('qrcode', () => ({ default: { toDataURL: engines.qr } }));
vi.mock('jsbarcode', () => ({ default: engines.barcode }));
import { LabelSheet } from './label-sheet';
const props = {
  records: [
    {
      kind: 'asset' as const,
      key: 'deferred-engine',
      name: 'Deferred engine',
      path: '/inventory/assets/deferred-engine',
      barcode: 'TEST-0123',
    },
  ],
  origin: 'https://inventory.example.test',
  preview: false,
  size: '90x50' as const,
  page: 'letter' as const,
  generation: 'one',
};
beforeEach(() => {
  vi.clearAllMocks();
  engines.qr.mockResolvedValue('data:image/png;base64,iVBORw0KGgo=');
  engines.barcode.mockImplementation((element: SVGSVGElement) => {
    element.setAttribute('width', '120');
    element.setAttribute('height', '80');
  });
});
it('does not invoke a barcode engine for QR and cancels a late barcode import after a mode change', async () => {
  const view = render(<LabelSheet {...props} format="code128" />);
  // The import resolves asynchronously. A changed context must cancel its SVG
  // write, dimensions and ready state, even when the engine arrives later.
  view.rerender(<LabelSheet {...props} format="qr" generation="two" />);
  await vi.dynamicImportSettled();
  expect(engines.barcode).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'true',
    ),
  );
  view.rerender(<LabelSheet {...props} format="code128" generation="three" />);
  await waitFor(() => expect(engines.barcode).toHaveBeenCalledOnce());
  expect(document.querySelector('svg')).toHaveAttribute(
    'viewBox',
    '0 0 120 80',
  );
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'true',
    ),
  );
});
it('keeps failed deferred QR generation unready so the existing print gate cannot authorize it', async () => {
  engines.qr.mockRejectedValueOnce(new Error('engine unavailable'));
  render(
    <LabelSheet
      {...props}
      records={[
        { ...props.records[0], path: '/inventory/assets/deferred-failure' },
      ]}
      format="qr"
    />,
  );
  await vi.dynamicImportSettled();
  await waitFor(() => expect(engines.qr).toHaveBeenCalled());
  expect(document.querySelector('.label-card')).toHaveAttribute(
    'data-code-ready',
    'false',
  );
});
