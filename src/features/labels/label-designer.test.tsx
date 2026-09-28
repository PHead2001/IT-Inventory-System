import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LiveLabel } from './queue.server';

const mocks = vi.hoisted(() => ({
  getQueueRecords: vi.fn(),
  searchLabelRecords: vi.fn(),
}));
vi.mock('./queue.server', () => ({
  getQueueRecords: mocks.getQueueRecords,
  searchLabelRecords: mocks.searchLabelRecords,
}));
vi.mock('@/features/locations/location-picker', () => ({
  LocationPicker: () => <div />,
}));
vi.mock('./label-sheet', () => ({
  LabelSheet: ({
    records,
    format,
    size,
    page,
  }: {
    records: LiveLabel[];
    format: string;
    size: string;
    page: string;
  }) => (
    <div
      className="label-print-root"
      data-size={size}
      data-page={page}
      aria-label="Print preview"
    >
      {records.map((record, index) => (
        <div
          key={index}
          className="label-card"
          data-code-ready="true"
          data-code-fallback={
            format === 'code128' && record.kind === 'quantity'
          }
        >
          {record.name} / {record.key}
        </div>
      ))}
    </div>
  ),
}));
import { LabelDesigner } from './label-designer';

const quantityId = '7b84a7cf-197b-45b1-8016-87482d124cb4';
const assetId = 'd6a2c785-1489-4dd0-83ea-d8dc2f249711';
const quantity: LiveLabel = {
  kind: 'quantity',
  key: quantityId,
  name: 'Adapters',
  context: 'Cables',
  categoryName: 'Cables',
  state: 'active',
  tag: null,
  barcode: null,
  path: '/inventory/quantity/' + quantityId,
};
const asset: LiveLabel = {
  kind: 'asset',
  key: assetId,
  name: 'Laptop',
  context: 'Computers / Shelf 1A',
  categoryName: 'Computers',
  state: 'active',
  tag: 'lap-001',
  barcode: 'lap-001',
  path: '/inventory/assets/' + assetId,
};
const props = {
  locations: [],
  categories: [],
  origin: 'https://inventory.example.test',
  memberId: 'member-a',
  preview: false,
  initial: [quantity, asset],
};
const printButton = () =>
  screen.getByRole('button', { name: /Print selected labels/ });

beforeEach(() => {
  sessionStorage.clear();
  mocks.getQueueRecords.mockReset().mockResolvedValue([quantity, asset]);
  mocks.searchLabelRecords.mockReset().mockResolvedValue({
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
  });
  vi.stubGlobal('print', vi.fn());
});

it('automatically validates the initial queue and prints only after final revalidation', async () => {
  let authorizedDuringPrint = false;
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      window.dispatchEvent(new Event('beforeprint'));
      authorizedDuringPrint =
        document
          .querySelector('.label-print-root')
          ?.getAttribute('data-print-authorized') === 'true';
    }),
  );
  render(<LabelDesigner {...props} />);
  expect(
    screen.queryByRole('button', { name: 'Prepare full print preview' }),
  ).toBeNull();
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(2),
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(1);
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2);
  expect(authorizedDuringPrint).toBe(true);
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
});

it('consumes one beforeprint lease even when afterprint never fires', async () => {
  const captures: boolean[] = [];
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      window.dispatchEvent(new Event('beforeprint'));
      captures.push(
        document
          .querySelector('.label-print-root')
          ?.getAttribute('data-print-authorized') === 'true',
      );
      window.dispatchEvent(new Event('beforeprint'));
      captures.push(
        document
          .querySelector('.label-print-root')
          ?.getAttribute('data-print-authorized') === 'true',
      );
    }),
  );
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(captures).toEqual([true, false]);
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
});

it('reflows copies and paper locally without another inventory read', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getAllByRole('spinbutton')[0], {
    target: { value: '2' },
  });
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(3),
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Label size' }), {
    target: { value: '70x35' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Page' }), {
    target: { value: 'A4' },
  });
  expect(document.querySelector('.label-print-root')).toHaveAttribute(
    'data-size',
    '70x35',
  );
  expect(document.querySelector('.label-print-root')).toHaveAttribute(
    'data-page',
    'A4',
  );
  expect(printButton()).toBeEnabled();
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(1);
});

it('retains the old sheet but denies printing during a new selection validation', async () => {
  let finish!: (rows: LiveLabel[]) => void;
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  expect(document.querySelectorAll('.label-card')).toHaveLength(2);
  expect(printButton()).toBeDisabled();
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2));
  finish([asset]);
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(1),
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
});

it('ignores an obsolete response after rapid selection changes', async () => {
  let finish!: (rows: LiveLabel[]) => void;
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  finish([asset]);
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(0),
  );
  expect(printButton()).toBeDisabled();
  expect(window.print).not.toHaveBeenCalled();
});

it('blocks unavailable rows and offers a bounded explicit retry after read failure', async () => {
  mocks.getQueueRecords.mockRejectedValueOnce(new Error('network'));
  render(<LabelDesigner {...props} />);
  await screen.findByRole('button', { name: 'Retry label refresh' });
  expect(printButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry label refresh' }));
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValueOnce([quantity]);
  fireEvent.click(printButton());
  expect(await screen.findByText(/Unavailable: asset:/)).toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  expect(window.print).not.toHaveBeenCalled();
});

it('requires acknowledgement of changed tag and then revalidates automatically', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValueOnce([
    quantity,
    { ...asset, tag: 'lap-002' },
  ]);
  fireEvent.click(printButton());
  mocks.getQueueRecords.mockResolvedValue([
    quantity,
    { ...asset, tag: 'lap-002' },
  ]);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Acknowledge changes' }),
  );
  expect(printButton()).toBeDisabled();
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('requires acknowledgement when Code 128 falls back to QR', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Code' }), {
    target: { value: 'code128' },
  });
  fireEvent.click(
    await screen.findByRole('button', { name: 'Acknowledge QR fallback' }),
  );
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
});

it('shows a quantity Item code in search results without replacing its UUID route', async () => {
  mocks.searchLabelRecords.mockResolvedValueOnce({
    rows: [
      {
        kind: 'quantity',
        key: quantityId,
        name: 'Adapters',
        categoryName: 'Cables',
        status: 'active',
        holdingContext: 'Shelf 1A',
        itemCode: 'SKU-0042',
        assetTag: null,
        serialNumber: null,
        manufacturer: null,
        model: null,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  render(<LabelDesigner {...props} />);
  expect(await screen.findByText('Item code: SKU-0042')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Adapters' })).toHaveAttribute(
    'href',
    '/inventory/quantity/' + quantityId,
  );
});

it('keeps printing disabled until the sheet font is ready', async () => {
  const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  let finish!: () => void;
  const ready = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const fonts = { status: 'loading', ready };
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  try {
    render(<LabelDesigner {...props} />);
    await waitFor(() =>
      expect(document.querySelectorAll('.label-card')).toHaveLength(2),
    );
    expect(printButton()).toBeDisabled();
    fonts.status = 'loaded';
    finish();
    await waitFor(() => expect(printButton()).toBeEnabled());
  } finally {
    if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
    else Reflect.deleteProperty(document, 'fonts');
  }
});
