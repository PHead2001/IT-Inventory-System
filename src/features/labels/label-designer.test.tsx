import { beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { defaultFilters, defaultJob, queueStorageKey } from './queue-model';
import type { LiveLabel } from './queue.server';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  query: '',
  getQueueRecords: vi.fn(),
  searchLabelRecords: vi.fn(),
}));
vi.mock('next/navigation', () => {
  const router = { replace: mocks.replace };
  return {
    useRouter: () => router,
    usePathname: () => '/labels',
    useSearchParams: () => new URLSearchParams(mocks.query),
  };
});
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
  mocks.query = '';
  mocks.replace.mockReset();
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

it('consumes a deep-linked addition so removed records do not return after reload', async () => {
  mocks.query = 'asset=' + assetId + '&keep=filters';
  mocks.getQueueRecords.mockResolvedValue([asset]);
  const view = render(
    <LabelDesigner
      {...props}
      initial={[asset]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByText('1 distinct records · 1 labels');
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenCalledWith('/labels?keep=filters', {
      scroll: false,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByText('0 distinct records · 0 labels');
  view.unmount();
  mocks.query = 'keep=filters';
  render(<LabelDesigner {...props} initial={[]} addIntent={[]} />);
  await screen.findByText('0 distinct records · 0 labels');
});
it('removes the last lifecycle warning immediately when its queued record is removed', async () => {
  const retired = { ...asset, state: 'retired' };
  mocks.getQueueRecords.mockResolvedValue([retired]);
  render(<LabelDesigner {...props} initial={[retired]} />);
  await screen.findByRole('button', { name: 'Acknowledge changes' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(
    screen.queryByRole('button', { name: 'Acknowledge changes' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Tag or lifecycle state changed for/),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/A tag or lifecycle state needs review/),
  ).not.toBeInTheDocument();
});

it('hydrates once and cannot re-add a removed initial record from a later server prop refresh', async () => {
  mocks.getQueueRecords.mockResolvedValue([asset]);
  const view = render(<LabelDesigner {...props} initial={[asset]} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  view.rerender(
    <LabelDesigner
      {...props}
      initial={[{ ...asset, name: 'Refetched laptop' }]}
    />,
  );
  expect(screen.getByText('0 distinct records · 0 labels')).toBeVisible();
  await waitFor(() =>
    expect(
      JSON.parse(
        sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
      ).entries,
    ).toHaveLength(0),
  );
});
it('removing A during pending A+B cancels A only and retains unrelated copies/settings while B is added once', async () => {
  const location: LiveLabel = {
    ...quantity,
    kind: 'location',
    key: 'ITC-CLEAR',
    name: 'Clear Container',
    path: '/locations/ITC-CLEAR',
  };
  const entry = (row: LiveLabel, copies: number) => ({
    kind: row.kind,
    key: row.key,
    copies,
    baselineTag: row.tag,
    baselineState: row.state,
    lifecycleAcknowledged: true,
  });
  const savedFilters = { ...defaultFilters, q: 'Saved filters' };
  const savedJob = { ...defaultJob, size: '70x35', page: 'A4' };
  sessionStorage.setItem(
    queueStorageKey(props.origin, props.memberId),
    JSON.stringify({
      entries: [entry(asset, 4), entry(location, 3)],
      filters: savedFilters,
      job: savedJob,
    }),
  );
  mocks.query =
    'asset=' + assetId + '&quantity=' + quantityId + '&keep=filters';
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue([location, quantity]);
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[
        { kind: 'asset', key: assetId },
        { kind: 'quantity', key: quantityId },
      ]}
    />,
  );
  await waitFor(() =>
    expect(mocks.getQueueRecords).toHaveBeenCalledWith([
      { kind: 'asset', key: assetId },
      { kind: 'quantity', key: quantityId },
    ]),
  );
  expect(screen.getAllByLabelText('Copies')[0]).toHaveValue(4);
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  await act(async () => finish([asset, quantity]));
  expect(screen.getByText('2 distinct records · 4 labels')).toBeVisible();
  await waitFor(() =>
    expect(mocks.replace).toHaveBeenLastCalledWith('/labels?keep=filters', {
      scroll: false,
    }),
  );
  const persisted = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(persisted.entries).toMatchObject([
    { key: location.key, copies: 3 },
    { key: quantityId, copies: 1 },
  ]);
  expect(persisted.filters).toEqual(savedFilters);
  expect(persisted.job).toEqual(savedJob);
  expect(
    persisted.entries.some((row: { key: string }) => row.key === assetId),
  ).toBe(false);
});
it('Clear cancels all pending additions without late-response resurrection', async () => {
  mocks.query = 'asset=' + assetId;
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByText('Adding linked records after restoring this queue…');
  fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
  await act(async () => finish([asset]));
  expect(screen.getByText('0 distinct records · 0 labels')).toBeVisible();
  expect(mocks.replace).toHaveBeenCalledWith('/labels', { scroll: false });
  expect(screen.queryByText(/Tag or lifecycle/)).not.toBeInTheDocument();
});
it('retains a failed lookup intent for an explicit retry instead of consuming it prematurely', async () => {
  mocks.query = 'asset=' + assetId;
  mocks.getQueueRecords
    .mockRejectedValueOnce(new Error('lookup failed'))
    .mockResolvedValue([asset]);
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByRole('button', { name: 'Retry linked additions' });
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry linked additions' }),
  );
  await screen.findByText('1 distinct records · 1 labels');
  expect(mocks.replace).toHaveBeenCalledWith('/labels', { scroll: false });
});
it('permits a new intentional addition of the same record after completed removal', async () => {
  mocks.query = 'asset=' + assetId;
  mocks.getQueueRecords.mockResolvedValue([asset]);
  const view = render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByText('1 distinct records · 1 labels');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  mocks.query = '';
  view.rerender(<LabelDesigner {...props} initial={[]} addIntent={[]} />);
  await act(async () => {});
  mocks.query = 'asset=' + assetId;
  view.rerender(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByText('1 distinct records · 1 labels');
  expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
});
it('removing one historical record preserves the remaining record lifecycle safeguard', async () => {
  const retired = { ...asset, state: 'retired' },
    archived = { ...quantity, state: 'archived' };
  mocks.getQueueRecords.mockResolvedValue([retired, archived]);
  render(<LabelDesigner {...props} initial={[retired, archived]} />);
  await screen.findByRole('button', { name: 'Acknowledge changes' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  expect(screen.getByRole('alert')).toHaveTextContent('Adapters');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Laptop');
  expect(
    screen.getByRole('button', { name: 'Acknowledge changes' }),
  ).toBeVisible();
  expect(printButton()).toBeDisabled();
});
it('reports that removal may not survive reload when queue persistence fails', async () => {
  const view = render(<LabelDesigner {...props} initial={[asset]} />);
  mocks.getQueueRecords.mockResolvedValue([asset]);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const storage = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await screen.findByText(/including removals, may not survive reload/);
  expect(screen.getByText('0 distinct records · 0 labels')).toBeVisible();
  storage.mockRestore();
  view.unmount();
});

it('merges an overlapping manual Add after a linked addition resolves instead of losing the manual result', async () => {
  mocks.query = 'asset=' + assetId;
  mocks.searchLabelRecords.mockResolvedValue({
    rows: [
      {
        kind: 'quantity',
        key: quantityId,
        name: quantity.name,
        categoryName: 'Cables',
        status: 'active',
        assetTag: null,
        itemCode: null,
        serialNumber: null,
        manufacturer: null,
        model: null,
        holdingContext: quantity.holdingContext,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  let finishLinked!: (rows: LiveLabel[]) => void,
    finishManual!: (rows: LiveLabel[]) => void;
  const linked = new Promise<LiveLabel[]>((resolve) => {
    finishLinked = resolve;
  });
  const manual = new Promise<LiveLabel[]>((resolve) => {
    finishManual = resolve;
  });
  mocks.getQueueRecords.mockImplementation((keys: { key: string }[]) =>
    keys.length > 1
      ? Promise.resolve([asset, quantity])
      : keys[0].key === assetId
        ? linked
        : manual,
  );
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }));
  await waitFor(() =>
    expect(mocks.getQueueRecords).toHaveBeenCalledWith([
      { kind: 'quantity', key: quantityId },
    ]),
  );
  await act(async () => finishLinked([asset]));
  expect(screen.getByText('1 distinct records · 1 labels')).toBeVisible();
  await act(async () => finishManual([quantity]));
  expect(screen.getByText('2 distinct records · 2 labels')).toBeVisible();
});
it('allows Clear to cancel a failed empty-queue linked intent and any subsequent delayed retry', async () => {
  mocks.query = 'asset=' + assetId;
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords
    .mockRejectedValueOnce(new Error('failed'))
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByRole('button', { name: 'Retry linked additions' });
  expect(screen.getByRole('button', { name: 'Clear queue' })).toBeEnabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry linked additions' }),
  );
  await screen.findByText('Adding linked records after restoring this queue…');
  fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
  await act(async () => finish([asset]));
  expect(screen.getByText('0 distinct records · 0 labels')).toBeVisible();
  expect(mocks.replace).toHaveBeenCalledWith('/labels', { scroll: false });
});
it.each([{ memberId: 'member-b' }, { origin: 'https://other.example.test' }])(
  'ignores a late linked lookup after queue scope changes %j',
  async (scope) => {
    mocks.query = 'asset=' + assetId;
    let finish!: (rows: LiveLabel[]) => void;
    mocks.getQueueRecords.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(
      <LabelDesigner
        {...props}
        initial={[]}
        addIntent={[{ kind: 'asset', key: assetId }]}
      />,
    );
    await screen.findByText(
      'Adding linked records after restoring this queue…',
    );
    mocks.query = 'keep=current';
    view.rerender(
      <LabelDesigner {...props} {...scope} initial={[]} addIntent={[]} />,
    );
    await act(async () => finish([asset]));
    expect(screen.getByText('0 distinct records · 0 labels')).toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
  },
);

it('searches once after initial hydration and once with restored filters on a revisit', async () => {
  const view = render(<LabelDesigner {...props} initial={[]} />);
  await screen.findByText(/0 matching records\. Scroll this list/);
  expect(mocks.searchLabelRecords).toHaveBeenCalledExactlyOnceWith(
    defaultFilters,
  );
  view.unmount();
  const restored = {
    ...defaultFilters,
    q: 'Adapters',
    type: 'quantity' as const,
    page: 2,
  };
  sessionStorage.setItem(
    queueStorageKey(props.origin, props.memberId),
    JSON.stringify({ entries: [], filters: restored, job: defaultJob }),
  );
  mocks.searchLabelRecords.mockClear();
  render(<LabelDesigner {...props} initial={[]} />);
  await screen.findByText(/0 matching records\. Scroll this list/);
  expect(mocks.searchLabelRecords).toHaveBeenCalledExactlyOnceWith(restored);
});

it.each([
  { memberId: 'member-b', origin: props.origin },
  { memberId: props.memberId, origin: 'https://other.example.test' },
])(
  'remounts a changed queue scope and ignores a late old search ($memberId, $origin)',
  async (scope) => {
    let finish!: (result: {
      rows: [];
      total: number;
      page: number;
      pageSize: number;
    }) => void;
    mocks.searchLabelRecords.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<LabelDesigner {...props} />);
    await waitFor(() =>
      expect(mocks.searchLabelRecords).toHaveBeenCalledTimes(1),
    );
    const restored = { ...defaultFilters, q: 'Current scope' };
    sessionStorage.setItem(
      queueStorageKey(scope.origin, scope.memberId),
      JSON.stringify({ entries: [], filters: restored, job: defaultJob }),
    );
    view.rerender(<LabelDesigner {...props} {...scope} initial={[]} />);
    await screen.findByText(/0 matching records\. Scroll this list/);
    expect(mocks.searchLabelRecords).toHaveBeenCalledTimes(2);
    expect(mocks.searchLabelRecords).toHaveBeenLastCalledWith(restored);
    expect(
      screen.getByRole('textbox', { name: /Name, serial, tag/ }),
    ).toHaveValue('Current scope');
    expect(document.querySelectorAll('.label-card')).toHaveLength(0);
    await act(async () => {
      finish({ rows: [], total: 99, page: 1, pageSize: 25 });
    });
    expect(screen.queryByText(/99 matching records/)).not.toBeInTheDocument();
    const stored = JSON.parse(
      sessionStorage.getItem(queueStorageKey(scope.origin, scope.memberId))!,
    );
    expect(stored.entries).toEqual([]);
    expect(stored.filters).toEqual(restored);
  },
);

it('continues searching and printing with an in-memory queue when browser storage is blocked', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('blocked');
    });
  try {
    render(<LabelDesigner {...props} />);
    await screen.findByText(/0 matching records\. Scroll this list/);
    expect(mocks.searchLabelRecords).toHaveBeenCalledExactlyOnceWith(
      defaultFilters,
    );
    expect(
      screen.getByText(/Browser storage is unavailable/),
    ).toBeInTheDocument();
    await waitFor(() => expect(printButton()).toBeEnabled());
    fireEvent.click(printButton());
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});

it('ignores a failed old search after the member submits newer filters', async () => {
  let fail!: (error: Error) => void;
  mocks.searchLabelRecords.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  render(<LabelDesigner {...props} initial={[]} />);
  await waitFor(() =>
    expect(mocks.searchLabelRecords).toHaveBeenCalledTimes(1),
  );
  fireEvent.change(screen.getByRole('textbox', { name: /Name, serial, tag/ }), {
    target: { value: 'Current filters' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Search label records' }));
  await screen.findByText(/0 matching records\. Scroll this list/);
  expect(mocks.searchLabelRecords).toHaveBeenCalledTimes(2);
  expect(mocks.searchLabelRecords).toHaveBeenLastCalledWith({
    ...defaultFilters,
    q: 'Current filters',
  });
  await act(async () => {
    fail(new Error('late old failure'));
  });
  expect(
    screen.queryByText(/Label search could not be loaded/),
  ).not.toBeInTheDocument();
});

it('describes queued locations as locations while retaining inventory category fallbacks', async () => {
  const location: LiveLabel = {
    kind: 'location',
    key: 'ITC-S1A',
    name: 'Shelf 1A',
    context: 'IT Closet / Shelf 1A',
    holdingContext: 'IT Closet / Shelf 1A',
    categoryName: null,
    state: 'active',
    tag: null,
    barcode: 'ITC-S1A',
    path: '/locations/ITC-S1A',
  };
  const uncategorized = { ...quantity, categoryName: null };
  mocks.getQueueRecords.mockResolvedValue([location, uncategorized]);
  render(<LabelDesigner {...props} initial={[location, uncategorized]} />);
  await waitFor(() =>
    expect(
      screen.getByText('Shelf 1A · Location · IT Closet / Shelf 1A · active'),
    ).toBeInTheDocument(),
  );
  expect(
    screen.getByText('Adapters · Uncategorized · ITC-S1A: 3 · active'),
  ).toBeInTheDocument();
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
