import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { queueStorageKey } from './queue-model';
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
    generation,
  }: {
    records: LiveLabel[];
    format: string;
    size: string;
    page: string;
    generation: string;
  }) => (
    <div
      className="label-print-root"
      data-size={size}
      data-page={page}
      data-sheet-generation={generation}
      aria-label="Print preview"
    >
      {records.map((record, index) => (
        <div
          key={index}
          className="label-card"
          data-code-ready={record.name.includes('delayed') ? 'false' : 'true'}
          data-sheet-generation={generation}
          data-text-measured={
            record.name.includes('delayed') ? 'false' : 'true'
          }
          data-text-overflow="false"
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
  holdingContext: 'ITC-S1A: 3',
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
  holdingContext: 'Computers / Shelf 1A',
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

it('updates stock and custody context without regenerating permanent print content', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const sheet = document.querySelector('.label-print-root')!;
  const originalGeneration = sheet.getAttribute('data-sheet-generation');
  const originalCard = sheet.querySelector('.label-card');
  mocks.getQueueRecords.mockResolvedValueOnce([
    {
      ...quantity,
      context: 'Cables / ITC-S1A: 9',
      holdingContext: 'ITC-S1A: 9',
    },
    {
      ...asset,
      context: 'Computers / West Office [W-01] · assigned site',
      holdingContext: 'West Office [W-01] · assigned site',
    },
  ]);
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(
      screen.getByRole('region', { name: 'Label queue' }),
    ).toHaveTextContent('ITC-S1A: 9'),
  );
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    'West Office [W-01] · assigned site',
  );
  expect(sheet).toHaveAttribute('data-sheet-generation', originalGeneration);
  expect(sheet.querySelector('.label-card')).toBe(originalCard);
  expect(sheet).not.toHaveTextContent('ITC-S1A: 9');
  expect(sheet).not.toHaveTextContent('West Office');
});

it('waits for the refreshed generation to finish code and fit measurement before printing', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValueOnce([
    { ...quantity, name: 'Fresh adapters delayed' },
    asset,
  ]);
  fireEvent.click(printButton());
  await screen.findAllByText(/Fresh adapters delayed/);
  expect(window.print).not.toHaveBeenCalled();
  const refreshed = Array.from(
    document.querySelectorAll<HTMLElement>('.label-card'),
  ).find((card) => card.textContent?.includes('Fresh adapters delayed'))!;
  expect(refreshed.dataset.codeReady).toBe('false');
  refreshed.dataset.textMeasured = 'true';
  expect(window.print).not.toHaveBeenCalled();
  refreshed.dataset.codeReady = 'true';
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
});

it('cancels a pending final print when the designer unmounts', async () => {
  const view = render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValueOnce([
    { ...quantity, name: 'Fresh adapters delayed' },
    asset,
  ]);
  fireEvent.click(printButton());
  await screen.findAllByText(/Fresh adapters delayed/);
  view.unmount();
  expect(window.print).not.toHaveBeenCalled();
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

it('revokes print authorization when the print dialog throws', async () => {
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      window.dispatchEvent(new Event('beforeprint'));
      expect(document.querySelector('.label-print-root')).toHaveAttribute(
        'data-print-authorized',
        'true',
      );
      throw new Error('Print dialog failed');
    }),
  );
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  await waitFor(() => expect(printButton()).toBeDisabled());
});

it('expires print authorization when the browser emits no print events', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
});

it.each(['archived', 'retired'])(
  'requires initial %s lifecycle acknowledgement before printing',
  async (state) => {
    const historical = { ...asset, state };
    mocks.getQueueRecords.mockResolvedValue([quantity, historical]);
    render(<LabelDesigner {...props} initial={[quantity, historical]} />);
    expect(
      await screen.findByRole('button', { name: 'Acknowledge changes' }),
    ).toBeVisible();
    expect(printButton()).toBeDisabled();
    expect(window.print).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Acknowledge changes' }),
    );
    await waitFor(() => expect(printButton()).toBeEnabled());
    expect(window.print).not.toHaveBeenCalled();
  },
);

it('rejects a same-count final response with different selected identities', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const otherAsset = { ...asset, key: '8d05f5f0-f737-47c0-b28b-c703c60bed74' };
  mocks.getQueueRecords.mockResolvedValueOnce([quantity, otherAsset]);
  fireEvent.click(printButton());
  expect(await screen.findByText(/Unavailable: asset:/)).toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  expect(window.print).not.toHaveBeenCalled();
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

it('starts from shared job defaults and restores local choices for the same member', async () => {
  const defaults = { size: '70x35', page: 'A4', format: 'qr' } as const;
  const view = render(<LabelDesigner {...props} defaults={defaults} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(screen.getByRole('combobox', { name: 'Label size' })).toHaveValue(
    '70x35',
  );
  expect(screen.getByRole('combobox', { name: 'Page' })).toHaveValue('A4');
  fireEvent.change(screen.getByRole('combobox', { name: 'Label size' }), {
    target: { value: '90x50' },
  });
  await waitFor(() =>
    expect(
      JSON.parse(
        sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
      ).job.size,
    ).toBe('90x50'),
  );
  view.unmount();
  render(<LabelDesigner {...props} defaults={defaults} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(screen.getByRole('combobox', { name: 'Label size' })).toHaveValue(
    '90x50',
  );
  expect(screen.getByRole('combobox', { name: 'Page' })).toHaveValue('A4');
});

it('locks print and job settings while adding a record asynchronously', async () => {
  const nextId = '8d05f5f0-f737-47c0-b28b-c703c60bed74';
  const next = { ...quantity, key: nextId, name: 'Cables' };
  mocks.searchLabelRecords.mockResolvedValueOnce({
    rows: [
      {
        kind: 'quantity',
        key: nextId,
        name: 'Cables',
        categoryName: 'Cables',
        status: 'active',
        holdingContext: 'Shelf 1A',
        itemCode: null,
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
  await waitFor(() => expect(printButton()).toBeEnabled());
  const add = await screen.findByRole('button', { name: 'Add to queue' });
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(add);
  expect(printButton()).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Label size' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Page' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Code' })).toBeDisabled();
  mocks.getQueueRecords.mockResolvedValueOnce([quantity, asset, next]);
  finish([next]);
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(3),
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('rejects an Add response for a different identity without queueing it', async () => {
  const requestedId = '8d05f5f0-f737-47c0-b28b-c703c60bed74';
  const wrongId = '482b9fd0-2464-45d6-b57d-3dbe61956971';
  mocks.searchLabelRecords.mockResolvedValueOnce({
    rows: [
      {
        kind: 'quantity',
        key: requestedId,
        name: 'Requested cables',
        categoryName: 'Cables',
        status: 'active',
        holdingContext: 'Shelf 1A',
        itemCode: null,
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
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValueOnce([
    { ...quantity, key: wrongId, name: 'Wrong cables' },
  ]);
  fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }));
  expect(
    await screen.findByText('That record is unavailable to this account.'),
  ).toBeVisible();
  expect(
    screen.getByRole('region', { name: 'Label queue' }),
  ).not.toHaveTextContent(wrongId);
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '2 distinct records',
  );
  expect(document.querySelectorAll('.label-card')).toHaveLength(2);
  expect(window.print).not.toHaveBeenCalled();
});

it('blocks refresh when the response contains every selected row plus an extra identity', async () => {
  mocks.getQueueRecords.mockResolvedValueOnce([
    quantity,
    asset,
    { ...quantity, key: '8d05f5f0-f737-47c0-b28b-c703c60bed74' },
  ]);
  render(<LabelDesigner {...props} />);
  expect(await screen.findByText(/unexpected.*record/i)).toBeVisible();
  expect(printButton()).toBeDisabled();
  expect(document.querySelectorAll('.label-card')).toHaveLength(0);
  expect(window.print).not.toHaveBeenCalled();
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
    { ...asset, tag: 'lap-002', barcode: 'lap-002' },
  ]);
  fireEvent.click(printButton());
  mocks.getQueueRecords.mockResolvedValue([
    quantity,
    { ...asset, tag: 'lap-002', barcode: 'lap-002' },
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
  const fallback = await screen.findByRole('alert');
  expect(fallback).toHaveTextContent(
    'queued record(s) will use stable QR links',
  );
  expect(fallback).toHaveTextContent('Long barcodes that do not fit');
  expect(screen.queryByText(/Some labels will use QR because/)).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Acknowledge QR fallback' }),
  ).toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Acknowledge QR fallback' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Acknowledge QR fallback' }),
  ).toBeNull();
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
