import { beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { LiveLabel } from './queue.server';
import { defaultFilters, queueStorageKey } from './queue-model';

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
  }: {
    records: LiveLabel[];
    format: string;
  }) => (
    <div className="label-print-root" aria-label="Print preview">
      {records.map((record, index) => (
        <div
          className="label-card"
          data-code-ready="true"
          data-code-fallback={
            format === 'code128' && record.kind === 'quantity'
          }
          key={index}
        >
          {record.name} / {record.key}
        </div>
      ))}
    </div>
  ),
}));
import { LabelDesigner } from './label-designer';

const quantityId = '7b84a7cf-197b-45b1-8016-87482d124cb4';
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
  key: 'd6a2c785-1489-4dd0-83ea-d8dc2f249711',
  name: 'Old laptop name',
  context: 'Computers / Shelf 1A',
  categoryName: 'Computers',
  state: 'active',
  tag: 'lap-001',
  barcode: 'lap-001',
  path: '/inventory/assets/d6a2c785-1489-4dd0-83ea-d8dc2f249711',
};
const props = {
  locations: [],
  categories: [],
  origin: 'https://inventory.example.test',
  memberId: 'member-a',
  preview: false,
  initial: [quantity, asset],
};
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

it('starts a new job from shared defaults while retaining valid saved-job choices', async () => {
  const defaults = {
    size: '70x35' as const,
    page: 'A4' as const,
    format: 'code128' as const,
  };
  const first = render(<LabelDesigner {...props} defaults={defaults} />);
  expect(screen.getByRole('combobox', { name: 'Label size' })).toHaveValue(
    '70x35',
  );
  expect(screen.getByRole('combobox', { name: 'Page' })).toHaveValue('A4');
  expect(screen.getByRole('combobox', { name: 'Code' })).toHaveValue('code128');
  first.unmount();
  sessionStorage.setItem(
    queueStorageKey(props.origin, props.memberId),
    JSON.stringify({
      entries: [],
      filters: defaultFilters,
      job: { size: '90x50', page: 'letter', format: 'qr' },
    }),
  );
  render(<LabelDesigner {...props} defaults={defaults} />);
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Label size' })).toHaveValue(
      '90x50',
    ),
  );
  expect(screen.getByRole('combobox', { name: 'Page' })).toHaveValue('letter');
  expect(screen.getByRole('combobox', { name: 'Code' })).toHaveValue('qr');
});

it('keeps a pending Add from being silently cancelled by print settings or queue edits', async () => {
  mocks.searchLabelRecords.mockResolvedValue({
    rows: [
      {
        kind: 'asset',
        key: asset.key,
        name: asset.name,
        categoryName: 'Computers',
        status: 'active',
        assetTag: asset.tag,
        serialNumber: null,
        manufacturer: null,
        model: null,
        holdingContext: 'ITC-S1A',
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  let resolveAdd!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementation(
    () =>
      new Promise<LiveLabel[]>((resolve) => {
        resolveAdd = resolve;
      }),
  );
  render(<LabelDesigner {...props} initial={[quantity]} />);
  await screen.findByRole('link', { name: asset.name });
  const queue = screen.getByRole('region', { name: 'Label queue' });
  fireEvent.change(within(queue).getByRole('spinbutton'), {
    target: { value: '3' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
  for (const label of ['Label size', 'Page', 'Code'])
    expect(screen.getByRole('combobox', { name: label })).toBeDisabled();
  expect(within(queue).getByRole('spinbutton')).toBeDisabled();
  expect(within(queue).getByRole('button', { name: 'Remove' })).toBeDisabled();
  await act(async () => resolveAdd([asset]));
  await waitFor(() => expect(queue).toHaveTextContent('2 distinct records'));
  expect(within(queue).getAllByRole('spinbutton')[0]).toHaveValue(3);
  expect(screen.getByRole('combobox', { name: 'Label size' })).toBeEnabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Label size' }), {
    target: { value: '70x35' },
  });
  expect(screen.getByRole('combobox', { name: 'Label size' })).toHaveValue(
    '70x35',
  );
  expect(queue).toHaveTextContent('2 distinct records');
  expect(within(queue).getAllByRole('spinbutton')[0]).toHaveValue(3);
});

it('keeps long search result names, identifiers, and site context inside the flexible text column', async () => {
  const longName = 'A'.repeat(200);
  const longContext = `Site ${'North'.repeat(50)}: 1 + 4 more; see item details`;
  mocks.searchLabelRecords.mockResolvedValue({
    rows: [
      {
        kind: 'asset',
        key: asset.key,
        name: longName,
        categoryName: 'Computers',
        status: 'active',
        assetTag: null,
        serialNumber: null,
        manufacturer: null,
        model: null,
        holdingContext: longContext,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  render(<LabelDesigner {...props} initial={[]} />);
  const link = await screen.findByRole('link', { name: longName });
  const textColumn = link.parentElement;
  expect(textColumn).toHaveClass('min-w-0', 'flex-1', 'basis-56');
  expect(textColumn).toHaveClass('[overflow-wrap:anywhere]');
  expect(link).toHaveClass('[overflow-wrap:anywhere]');
  expect(screen.getByText(/see item details/)).toHaveClass(
    '[overflow-wrap:anywhere]',
  );
  expect(textColumn?.parentElement).toHaveClass('max-w-full', 'min-w-0');
  expect(screen.getByRole('button', { name: 'Add to queue' })).toBeEnabled();
});

it('prints every mixed-queue copy only after a fresh exact-ID read', async () => {
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      expect(document.querySelector('.label-print-root')).toHaveAttribute(
        'data-print-authorized',
        'true',
      );
    }),
  );
  render(<LabelDesigner {...props} />);
  await waitFor(() =>
    expect(screen.getAllByRole('spinbutton')).toHaveLength(2),
  );
  fireEvent.change(screen.getAllByRole('spinbutton')[0], {
    target: { value: '3' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(4),
  );
  expect(mocks.getQueueRecords).toHaveBeenCalledWith([
    { kind: 'quantity', key: quantityId },
    { kind: 'asset', key: asset.key },
  ]);
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(document.querySelector('.label-print-root')).toHaveAttribute(
    'data-print-authorized',
    'true',
  );
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2);
});

it('blocks printing after tag change until explicit acknowledgement and re-preview', async () => {
  render(<LabelDesigner {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(2),
  );
  mocks.getQueueRecords.mockResolvedValue([
    quantity,
    { ...asset, tag: 'lap-002' },
  ]);
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  expect(
    await screen.findByRole('button', { name: 'Acknowledge changes' }),
  ).toBeInTheDocument();
  expect(window.print).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge changes' }));
  expect(
    screen.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: /Print selected labels/ }),
    ).toBeEnabled(),
  );
});

it('refreshes ordinary display text without approval and blocks inaccessible IDs', async () => {
  mocks.getQueueRecords.mockResolvedValueOnce([
    quantity,
    { ...asset, name: 'Current laptop name', context: 'Computers / Shelf 2A' },
  ]);
  render(<LabelDesigner {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  expect(
    await screen.findByText(/Current laptop name \/ d6a2c785/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Acknowledge changes' }),
  ).toBeNull();
  mocks.getQueueRecords.mockResolvedValueOnce([quantity]);
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  expect(await screen.findByText(/Unavailable: asset:/)).toBeInTheDocument();
  expect(window.print).not.toHaveBeenCalled();
  expect(
    screen.getByRole('button', { name: /Print selected labels/ }),
  ).toBeDisabled();
});

it('prints refreshed descriptive text in the same action without confirmation', async () => {
  render(<LabelDesigner {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(2),
  );
  mocks.getQueueRecords.mockResolvedValue([
    quantity,
    {
      ...asset,
      name: 'Renamed laptop',
      categoryName: 'Renamed computers',
      context: 'Renamed computers / Shelf 2A',
    },
  ]);
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      expect(
        screen.getByText(/Renamed laptop \/ d6a2c785/),
      ).toBeInTheDocument();
      expect(document.querySelector('.label-print-root')).toHaveAttribute(
        'data-print-authorized',
        'true',
      );
    }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(document.querySelector('.label-print-root')).toHaveAttribute(
    'data-print-authorized',
    'true',
  );
  window.dispatchEvent(new Event('afterprint'));
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Label information refreshed',
  );
  expect(
    screen.queryByRole('button', { name: 'Acknowledge changes' }),
  ).toBeNull();
});

it('clears print authorization even when the browser print call throws', async () => {
  let sheet: Element | null = null;
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      sheet = document.querySelector('.label-print-root');
      throw new Error('print unavailable');
    }),
  );
  render(<LabelDesigner {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(2),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  await screen.findByText(
    'Final label check failed. Printing is blocked; retry.',
  );
  expect(sheet).not.toHaveAttribute('data-print-authorized');
});

it('closes authorization after a bounded wait if the browser omits afterprint', async () => {
  const scheduled = vi.spyOn(window, 'setTimeout');
  render(<LabelDesigner {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(2),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  const deadline = scheduled.mock.calls.find(
    ([, delay]) => delay === 30_000,
  )?.[0];
  expect(deadline).toBeTypeOf('function');
  expect(document.querySelector('.label-print-root')).toHaveAttribute(
    'data-print-authorized',
    'true',
  );
  (deadline as () => void)();
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  scheduled.mockRestore();
});

it('requires one explicit acknowledgement for an initially archived record', async () => {
  const archived = { ...quantity, state: 'archived' };
  mocks.getQueueRecords.mockResolvedValue([archived]);
  render(<LabelDesigner {...props} initial={[archived]} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  expect(document.querySelectorAll('.label-card')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge changes' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(1),
  );
  expect(
    screen.queryByRole('button', { name: 'Acknowledge changes' }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
});

it('requires explicit acknowledgement when requested Code 128 falls back to QR', async () => {
  render(<LabelDesigner {...props} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Code' }), {
    target: { value: 'code128' },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  await waitFor(() =>
    expect(document.querySelectorAll('.label-card')).toHaveLength(2),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  expect(
    await screen.findByRole('button', { name: 'Acknowledge QR fallback' }),
  ).toBeVisible();
  expect(window.print).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Acknowledge QR fallback' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: /Print selected labels/ }),
  );
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
});

it('ignores a stale preflight when the queue changes during its read', async () => {
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<LabelDesigner {...props} />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Prepare full print preview' }),
  );
  fireEvent.change(screen.getAllByRole('spinbutton')[0], {
    target: { value: '2' },
  });
  finish([quantity, asset]);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare full print preview' }),
    ).toBeEnabled(),
  );
  expect(document.querySelectorAll('.label-card')).toHaveLength(0);
  expect(window.print).not.toHaveBeenCalled();
});
