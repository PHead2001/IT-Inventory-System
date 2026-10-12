import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { defaultFilters, defaultJob, queueStorageKey } from './queue-model';
import type { LiveLabel } from './queue.server';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  query: '',
  getQueueRecords: vi.fn(),
  searchLabelRecords: vi.fn(),
  readLogoutPrivacyGeneration: vi.fn(),
  acknowledgeLogoutPrivacyGeneration: vi.fn(),
  readProtectedPrivacyIdentity: vi.fn(),
  authChanged: null as
    null | ((event: string, session: { user: { id: string } } | null) => void),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      onAuthStateChange: (fn: typeof mocks.authChanged) => {
        mocks.authChanged = fn;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));
vi.mock('@/lib/auth/actions', () => ({
  readLogoutPrivacyGeneration: mocks.readLogoutPrivacyGeneration,
  acknowledgeLogoutPrivacyGeneration: mocks.acknowledgeLogoutPrivacyGeneration,
  readProtectedPrivacyIdentity: mocks.readProtectedPrivacyIdentity,
}));
vi.mock('@/lib/auth/logout-transport', () => ({
  readLogoutPrivacyGeneration: mocks.readLogoutPrivacyGeneration,
  acknowledgeLogoutPrivacyGeneration: mocks.acknowledgeLogoutPrivacyGeneration,
  readProtectedPrivacyIdentity: mocks.readProtectedPrivacyIdentity,
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
            format === 'code128' &&
            (record.kind === 'quantity' ||
              record.name.includes('physical fallback'))
          }
        >
          {record.name} / {record.key}
        </div>
      ))}
    </div>
  ),
}));
import { LabelDesigner } from './label-designer';
import { ProtectedPrivacyBoundary } from '@/components/auth/auth-privacy';
import { logoutAcknowledgementKey } from '@/lib/auth/privacy-barrier';
import { AssignmentScopeGuard } from '@/features/scan/assignment-scope-guard';
import {
  invalidateAssignmentPrivacy,
  readAuthoritativeCleanupRevision,
  assignmentEpoch,
} from '@/features/scan/assign-batch';

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

it.each(['101', '0', '-1', '1.5', ''])(
  'retains invalid Copies draft %j beside its last valid count and blocks output until correction',
  async (raw) => {
    render(<LabelDesigner {...props} />);
    await waitFor(() => expect(printButton()).toBeEnabled());
    const input = screen.getAllByRole('spinbutton', { name: 'Copies' })[0];
    fireEvent.change(input, { target: { value: '3' } });
    await waitFor(() => expect(printButton()).toBeEnabled());
    const reads = mocks.getQueueRecords.mock.calls.length;
    fireEvent.change(input, { target: { value: raw } });
    expect(input).toHaveValue(raw === '' ? null : Number(raw));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      `${raw === '' ? 'Empty value' : `“${raw}”`} is invalid. Use whole numbers from 1–100 copies per record and at most 500 labels total. Last valid count: 3 copies. Printing is paused until corrected or reverted.`,
    );
    expect(printButton()).toBeDisabled();
    expect(screen.queryByLabelText('Print preview')).toBeNull();
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('[data-print-authorized="true"]')).toBeNull();
    expect(mocks.getQueueRecords).toHaveBeenCalledTimes(reads);
    fireEvent.change(input, { target: { value: '2' } });
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(printButton()).toBeEnabled());
    expect(document.querySelectorAll('.label-card')).toHaveLength(3);
    fireEvent.click(printButton());
    await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  },
);

it('keeps a 501-label draft unresolved across other edits and reload, with explicit revert', async () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({
    ...quantity,
    key: `7b84a7cf-197b-45b1-8016-${index.toString(16).padStart(12, '0')}`,
    name: `Adapters ${index}`,
  }));
  mocks.getQueueRecords.mockResolvedValue(rows);
  const view = render(<LabelDesigner {...props} initial={rows} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const controls = screen.getAllByRole('spinbutton', { name: 'Copies' });
  for (let index = 0; index < 5; index++)
    fireEvent.change(controls[index], {
      target: { value: index === 4 ? '99' : '100' },
    });
  fireEvent.change(controls[5], { target: { value: '2' } });
  expect(controls[5]).toHaveAttribute('aria-invalid', 'true');
  expect(controls[5]).toHaveAccessibleDescription(/Last valid count: 1 copy/);
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '500 labels',
  );
  fireEvent.change(controls[0], { target: { value: '99' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Paper size' }), {
    target: { value: 'A4' },
  });
  expect(controls[5]).toHaveValue(2);
  expect(printButton()).toBeDisabled();
  view.unmount();
  render(<LabelDesigner {...props} initial={[]} />);
  const restored = await screen.findAllByRole('spinbutton', { name: 'Copies' });
  expect(restored[5]).toHaveValue(2);
  expect(restored[5]).toHaveAttribute('aria-invalid', 'true');
  expect(printButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Revert Copies' }));
  expect(restored[5]).toHaveValue(1);
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(document.querySelectorAll('.label-card')).toHaveLength(499);
});

it('cleans up only removed copy drafts and Clear removes every unresolved edit', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const inputs = screen.getAllByRole('spinbutton', { name: 'Copies' });
  fireEvent.change(inputs[0], { target: { value: '101' } });
  fireEvent.change(inputs[1], { target: { value: '' } });
  const queue = screen.getByRole('region', { name: 'Label queue' });
  fireEvent.click(within(queue).getAllByRole('button', { name: 'Remove' })[0]);
  expect(screen.getAllByRole('button', { name: 'Revert Copies' })).toHaveLength(
    1,
  );
  expect(screen.getByRole('spinbutton', { name: 'Copies' })).toHaveValue(null);
  expect(printButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
  expect(screen.queryByRole('button', { name: 'Revert Copies' })).toBeNull();
  expect(
    JSON.parse(
      sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
    ).copyDrafts,
  ).toEqual({});
});

it('cancels a pending final read even when an invalid Copies draft is corrected before the read resolves', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(printButton());
  fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Copies' })[0], {
    target: { value: '101' },
  });
  // Programmatic events exercise the synchronous guard even during busy work.
  fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Copies' })[0], {
    target: { value: '1' },
  });
  await act(async () => {
    finish([quantity, asset]);
  });
  expect(window.print).not.toHaveBeenCalled();
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
});

it('cancels pending image readiness after an invalid Copies edit', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const image = document.createElement('img');
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 320 },
  });
  let finish!: () => void;
  image.decode = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  document.querySelector('.label-card')!.append(image);
  fireEvent.click(printButton());
  await waitFor(() => expect(image.decode).toHaveBeenCalledOnce());
  fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Copies' })[0], {
    target: { value: '' },
  });
  await act(async () => {
    finish();
  });
  expect(window.print).not.toHaveBeenCalled();
  expect(printButton()).toBeDisabled();
  expect(document.querySelector('[data-print-authorized="true"]')).toBeNull();
});

it('synchronously revokes an armed native beforeprint grant on invalid Copies edit', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const sheet = document.querySelector<HTMLElement>('.label-print-root')!;
  let authorization: string | undefined;
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      fireEvent.change(
        screen.getAllByRole('spinbutton', { name: 'Copies' })[0],
        { target: { value: '101' } },
      );
      window.dispatchEvent(new Event('beforeprint'));
      authorization = sheet.dataset.printAuthorized;
    }),
  );
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(authorization).toBeUndefined();
  expect(printButton()).toBeDisabled();
  expect(screen.getAllByRole('spinbutton', { name: 'Copies' })[0]).toHaveValue(
    101,
  );
});

async function reviewAndAcknowledge(name = 'Laptop') {
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  const row = within(notice).getByRole('heading', {
    name: new RegExp('^' + name),
  }).parentElement!;
  await waitFor(() =>
    expect(
      within(row).getByRole('button', { name: 'Review item' }),
    ).toBeEnabled(),
  );
  fireEvent.click(within(row).getByRole('button', { name: 'Review item' }));
  const historical = within(row).queryByRole('checkbox');
  if (historical) fireEvent.click(historical);
  fireEvent.click(
    within(row).getByRole('button', { name: 'Acknowledge reviewed item' }),
  );
}

beforeEach(() => {
  mocks.query = '';
  mocks.replace.mockReset();
  mocks.authChanged = null;
  mocks.readLogoutPrivacyGeneration
    .mockReset()
    .mockResolvedValue({ status: 'absent' });
  mocks.acknowledgeLogoutPrivacyGeneration
    .mockReset()
    .mockResolvedValue({ status: 'match' });
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
afterEach(() => vi.restoreAllMocks());

it('keeps the label queue usable while a deferred search is busy and clears busy on failure', async () => {
  let fail!: (reason: Error) => void;
  mocks.searchLabelRecords.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = reject;
    }),
  );
  render(<LabelDesigner {...props} />);
  const results = screen.getByRole('region', { name: 'Label search results' });
  await waitFor(() => expect(mocks.searchLabelRecords).toHaveBeenCalled());
  expect(results).toHaveAttribute('aria-busy', 'true');
  expect(
    results.querySelector('[data-loading-shape="rows"]'),
  ).toBeInTheDocument();
  expect(screen.getByText('Loading matching records…')).toHaveClass('sr-only');
  const queue = screen.getByRole('region', { name: 'Label queue' });
  expect(
    screen.getByText('Loading matching records…').closest('[aria-busy="true"]'),
  ).toBeNull();
  await within(queue).findByText(/^Laptop ·/);
  await act(async () => fail(new Error('private backend detail')));
  expect(results).toHaveAttribute('aria-busy', 'false');
  expect(
    screen.queryByText('Loading matching records…'),
  ).not.toBeInTheDocument();
  expect(
    results.querySelector('[data-loading-shape="rows"]'),
  ).not.toBeInTheDocument();
  expect(queue).toHaveTextContent('Laptop');
  expect(
    screen.getByText('Label search could not be loaded. Try again.'),
  ).toBeVisible();
  expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
});

const restoredLocation: LiveLabel = {
  ...quantity,
  kind: 'location',
  key: 'ITC-CLEAR',
  name: 'Clear Container',
  path: '/locations/ITC-CLEAR',
};
const restoredRows = [asset, quantity, restoredLocation];
function saveMixedQueue() {
  const entries = restoredRows.map((record, index) => ({
    kind: record.kind,
    key: record.key,
    copies: index + 2,
    baselineTag: record.tag,
    baselineState: record.state,
    lifecycleAcknowledged: true,
  }));
  sessionStorage.setItem(
    queueStorageKey(props.origin, props.memberId),
    JSON.stringify({ entries, filters: defaultFilters, job: defaultJob }),
  );
  return entries;
}
function expectPrivateQueueIdentity(queue: HTMLElement) {
  for (const record of restoredRows) {
    expect(queue).not.toHaveTextContent(record.key);
    for (const control of within(queue).getAllByRole('button'))
      expect(control).not.toHaveAccessibleName(new RegExp(record.key));
    for (const control of within(queue).getAllByRole('spinbutton'))
      expect(control).not.toHaveAccessibleName(new RegExp(record.key));
  }
}
it('restores a mixed queue with human refreshing labels until the authorized deferred read supplies names', async () => {
  const savedEntries = saveMixedQueue();
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue(restoredRows);
  render(<LabelDesigner {...props} initial={[]} />);
  const queue = screen.getByRole('region', { name: 'Label queue' });
  await within(queue).findByText('Individual asset 1 · refreshing…');
  expect(
    within(queue).getByText('Quantity item 2 · refreshing…'),
  ).toBeVisible();
  expect(within(queue).getByText('Location 3 · refreshing…')).toBeVisible();
  expectPrivateQueueIdentity(queue);
  expect(
    queue.querySelector('[data-loading-shape="queue-row"]'),
  ).toBeInTheDocument();
  const announcement = within(queue).getByText(
    'Loading queued record details…',
  );
  expect(announcement).toHaveClass('sr-only');
  expect(announcement.closest('[aria-busy="true"]')).toBeNull();
  expect(printButton()).toBeDisabled();
  await waitFor(() =>
    expect(mocks.getQueueRecords).toHaveBeenCalledWith(
      savedEntries.map(({ kind, key }) => ({ kind, key })),
    ),
  );
  await act(async () => finish(restoredRows));
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(queue).toHaveTextContent('Laptop');
  expect(queue).toHaveTextContent('Adapters');
  expect(queue).toHaveTextContent('Clear Container');
  expect(
    queue.querySelector('[data-loading-shape="queue-row"]'),
  ).not.toBeInTheDocument();
  expect(
    within(queue)
      .getAllByRole('spinbutton')
      .map((input) => (input as HTMLInputElement).value),
  ).toEqual(['2', '3', '4']);
  expect(
    JSON.parse(
      sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
    ).entries,
  ).toEqual(savedEntries);
});
it.each(['missing', 'failure'] as const)(
  'shows human mixed-queue %s states without keys or cached unauthorized names',
  async (outcome) => {
    saveMixedQueue();
    mocks.getQueueRecords.mockResolvedValue(restoredRows);
    render(<LabelDesigner {...props} initial={[]} />);
    await waitFor(() => expect(printButton()).toBeEnabled());
    const queue = screen.getByRole('region', { name: 'Label queue' });
    if (outcome === 'missing') mocks.getQueueRecords.mockResolvedValueOnce([]);
    else
      mocks.getQueueRecords.mockRejectedValueOnce(
        new Error('Private read detail ' + assetId),
      );
    fireEvent.click(printButton());
    const state =
      outcome === 'missing'
        ? 'unavailable to this account'
        : 'refresh failed; retry';
    await within(queue).findByText('Individual asset 1 · ' + state);
    expect(within(queue).getByText('Quantity item 2 · ' + state)).toBeVisible();
    expect(within(queue).getByText('Location 3 · ' + state)).toBeVisible();
    expectPrivateQueueIdentity(queue);
    for (const record of restoredRows)
      expect(queue).not.toHaveTextContent(record.name);
    expect(printButton()).toBeDisabled();
    expect(window.print).not.toHaveBeenCalled();
    if (outcome === 'failure') {
      let finish!: (rows: LiveLabel[]) => void;
      mocks.getQueueRecords.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      fireEvent.click(
        screen.getByRole('button', { name: 'Retry label refresh' }),
      );
      await within(queue).findByText('Individual asset 1 · refreshing…');
      expectPrivateQueueIdentity(queue);
      await waitFor(() =>
        expect(mocks.getQueueRecords).toHaveBeenCalledTimes(3),
      );
      await act(async () => finish(restoredRows));
      await waitFor(() => expect(printButton()).toBeEnabled());
    } else {
      fireEvent.click(
        within(queue).getAllByRole('button', {
          name: /^Remove$/,
        })[1],
      );
      await waitFor(() =>
        expect(
          JSON.parse(
            sessionStorage.getItem(
              queueStorageKey(props.origin, props.memberId),
            )!,
          ).entries.map((entry: { key: string }) => entry.key),
        ).toEqual([assetId, restoredLocation.key]),
      );
    }
  },
);

it('retains a queue with invalid cached geometry and blocks its preview until explicit reset', async () => {
  mocks.getQueueRecords.mockResolvedValue([quantity]);
  sessionStorage.setItem(
    queueStorageKey(props.origin, props.memberId),
    JSON.stringify({
      entries: [
        {
          kind: quantity.kind,
          key: quantity.key,
          copies: 3,
          baselineTag: null,
          baselineState: 'active',
          lifecycleAcknowledged: true,
        },
      ],
      filters: defaultFilters,
      job: {
        ...defaultJob,
        layout: {
          version: 1,
          mode: 'single',
          labelWidth: null,
          labelHeight: 350,
        },
      },
    }),
  );
  render(<LabelDesigner {...props} initial={[]} />);
  expect(
    await screen.findByText(/The saved print dimensions are invalid/),
  ).toBeVisible();
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '3 labels',
  );
  expect(printButton()).toBeDisabled();
  expect(screen.queryByLabelText('Print preview')).toBeNull();
  const saved = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(saved.job.layout.labelWidth).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reset print media' }));
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(
    JSON.parse(
      sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
    ).entries[0].copies,
  ).toBe(3);
});

it('invalid raw geometry revokes print authorization without another inventory fetch', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const calls = mocks.getQueueRecords.mock.calls.length;
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'sheet' },
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  const before = document
    .querySelector('.label-print-root')
    ?.getAttribute('data-sheet-generation');
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '90.' },
  });
  expect(printButton()).toBeDisabled();
  expect(screen.queryByLabelText('Print preview')).toBeNull();
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(calls);
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '90.1' },
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(
    document
      .querySelector('.label-print-root')
      ?.getAttribute('data-sheet-generation'),
  ).not.toBe(before);
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(calls);
});

it('changing barcode type preserves an invalid raw media draft and blocks preview', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'sheet' },
  });
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '90.' },
  });
  expect(printButton()).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Barcode type' }), {
    target: { value: 'code128' },
  });
  expect(screen.getByRole('combobox', { name: 'Barcode type' })).toHaveValue(
    'code128',
  );
  expect(screen.getByLabelText('Label width (mm)')).toHaveValue('90.');
  expect(screen.queryByLabelText('Print preview')).toBeNull();
  expect(printButton()).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '90.1' },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Print preview')).toBeVisible(),
  );
});

it.each(['90.', ''])(
  'retains raw media draft %j and queue copies across reload until correction',
  async (raw) => {
    const view = render(<LabelDesigner {...props} />);
    await waitFor(() => expect(printButton()).toBeEnabled());
    fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Copies' })[0], {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
      target: { value: 'sheet' },
    });
    fireEvent.change(screen.getByLabelText('Label width (mm)'), {
      target: { value: raw },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Barcode type' }), {
      target: { value: 'code128' },
    });
    const key = queueStorageKey(props.origin, props.memberId);
    await waitFor(() =>
      expect(
        JSON.parse(sessionStorage.getItem(key)!).mediaDraft?.labelWidth,
      ).toBe(raw),
    );
    view.unmount();
    render(<LabelDesigner {...props} initial={[]} />);
    await waitFor(() =>
      expect(screen.getByLabelText('Label width (mm)')).toHaveValue(raw),
    );
    expect(screen.getByRole('combobox', { name: 'Output' })).toHaveValue(
      'sheet',
    );
    expect(screen.getByRole('combobox', { name: 'Barcode type' })).toHaveValue(
      'code128',
    );
    expect(
      screen.getAllByRole('spinbutton', { name: 'Copies' })[0],
    ).toHaveValue(3);
    expect(printButton()).toBeDisabled();
    expect(screen.queryByLabelText('Print preview')).toBeNull();
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelector('[data-print-authorized="true"]')).toBeNull();
    fireEvent.change(screen.getByLabelText('Label width (mm)'), {
      target: { value: '90.1' },
    });
    await waitFor(() =>
      expect(screen.getByLabelText('Print preview')).toBeVisible(),
    );
    expect(JSON.parse(sessionStorage.getItem(key)!).job.layout.labelWidth).toBe(
      901,
    );
  },
);

it('blocks a forged raw draft for different valid geometry before native printing and requires explicit reset', async () => {
  const key = queueStorageKey(props.origin, props.memberId);
  sessionStorage.setItem(
    key,
    JSON.stringify({
      entries: [],
      filters: defaultFilters,
      job: {
        ...defaultJob,
        layout: {
          version: 1,
          mode: 'single',
          labelWidth: 700,
          labelHeight: 350,
        },
      },
      mediaDraft: { mode: 'single', labelWidth: '80', labelHeight: '35' },
    }),
  );
  render(<LabelDesigner {...props} />);
  window.dispatchEvent(new Event('beforeprint'));
  expect(document.querySelector('[data-print-authorized="true"]')).toBeNull();
  await screen.findByText(/The saved print dimensions are invalid/);
  expect(printButton()).toBeDisabled();
  expect(screen.queryByLabelText('Print preview')).toBeNull();
  expect(screen.getByLabelText('Label width (mm)')).toHaveValue('80');
  fireEvent.change(screen.getByRole('combobox', { name: 'Barcode type' }), {
    target: { value: 'code128' },
  });
  expect(printButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset print media' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Print preview')).toBeVisible(),
  );
  expect(JSON.parse(sessionStorage.getItem(key)!).mediaDraft).toBeUndefined();
});

it('changing barcode type preserves invalid cached media until explicit reset', async () => {
  const badLayout = {
    version: 1,
    mode: 'single',
    labelWidth: null,
    labelHeight: 350,
  };
  sessionStorage.setItem(
    queueStorageKey(props.origin, props.memberId),
    JSON.stringify({
      entries: [],
      filters: defaultFilters,
      job: { ...defaultJob, layout: badLayout },
    }),
  );
  render(<LabelDesigner {...props} />);
  expect(
    await screen.findByText(/The saved print dimensions are invalid/),
  ).toBeVisible();
  fireEvent.change(screen.getByRole('combobox', { name: 'Barcode type' }), {
    target: { value: 'code128' },
  });
  expect(screen.getByRole('combobox', { name: 'Barcode type' })).toHaveValue(
    'code128',
  );
  expect(
    screen.getByText(/The saved print dimensions are invalid/),
  ).toBeVisible();
  expect(screen.queryByLabelText('Print preview')).toBeNull();
  expect(printButton()).toBeDisabled();
  const saved = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(saved.job.layout).toEqual(badLayout);
  expect(saved.job.format).toBe('code128');
  fireEvent.click(screen.getByRole('button', { name: 'Reset print media' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Print preview')).toBeVisible(),
  );
});

it('cancels a final authorized read when media changes, then revalidates the new print', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'single' },
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  let resolve!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(printButton());
  fireEvent.change(screen.getByLabelText('Label width (mm)'), {
    target: { value: '80' },
  });
  await act(async () => {
    resolve([quantity, asset]);
  });
  expect(window.print).not.toHaveBeenCalled();
  await waitFor(() => expect(printButton()).toBeEnabled());
  const calls = mocks.getQueueRecords.mock.calls.length;
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(calls + 1);
});

it('cancels readiness while an image decode is outstanding after a media edit', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'single' },
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  const image = document.createElement('img');
  image.src = 'data:image/png;base64,decode';
  Object.defineProperties(image, {
    complete: { value: true },
    naturalWidth: { value: 320 },
  });
  let finish!: () => void;
  image.decode = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  document.querySelector('.label-card')!.append(image);
  fireEvent.click(printButton());
  await waitFor(() => expect(image.decode).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Label height (mm)'), {
    target: { value: '40' },
  });
  await act(async () => {
    finish();
  });
  expect(window.print).not.toHaveBeenCalled();
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
});

it('synchronously revokes the one-lifecycle grant before a media edit can reuse beforeprint', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Output' }), {
    target: { value: 'single' },
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  let authorization: string | undefined;
  vi.stubGlobal(
    'print',
    vi.fn(() => {
      fireEvent.change(screen.getByLabelText('Label width (mm)'), {
        target: { value: '90.' },
      });
      window.dispatchEvent(new Event('beforeprint'));
      authorization =
        document.querySelector<HTMLElement>('.label-print-root')?.dataset
          .printAuthorized;
    }),
  );
  fireEvent.click(printButton());
  await waitFor(() => expect(window.print).toHaveBeenCalledOnce());
  expect(authorization).toBeUndefined();
  expect(printButton()).toBeDisabled();
});

it('omits empty search paging without changing the existing label queue', async () => {
  render(<LabelDesigner {...props} />);
  expect(
    await screen.findByText('No records match these filters.'),
  ).toBeVisible();
  expect(screen.getByText(/0 matching records/)).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Previous' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '2 distinct records · 2 labels',
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
});

it('shares defaults vocabulary and options while keeping changes in the current job', async () => {
  const defaults = {
    size: '70x35' as const,
    page: 'A4' as const,
    format: 'code128' as const,
  };
  const view = render(<LabelDesigner {...props} defaults={defaults} />);
  const size = screen.getByRole('combobox', { name: 'Label size' });
  const paper = screen.getByRole('combobox', { name: 'Paper size' });
  const barcode = screen.getByRole('combobox', { name: 'Barcode type' });
  expect(size).toHaveValue('70x35');
  expect(paper).toHaveValue('A4');
  expect(barcode).toHaveValue('code128');
  expect(barcode).toHaveAccessibleDescription(
    /Scanning a QR code opens the linked inventory record or location/,
  );
  expect(
    within(paper).getByRole('option', { name: 'US Letter (8.5 × 11 in)' }),
  ).toHaveValue('letter');
  expect(within(barcode).getByRole('option', { name: 'QR code' })).toHaveValue(
    'qr',
  );
  await waitFor(() => expect(size).toBeEnabled());
  fireEvent.change(size, { target: { value: '90x50' } });
  fireEvent.change(paper, { target: { value: 'letter' } });
  fireEvent.change(barcode, { target: { value: 'qr' } });
  view.rerender(
    <LabelDesigner
      {...props}
      defaults={{ size: '70x35', page: 'A4', format: 'code128' }}
    />,
  );
  expect(size).toHaveValue('90x50');
  expect(paper).toHaveValue('letter');
  expect(barcode).toHaveValue('qr');
  expect(defaults).toEqual({ size: '70x35', page: 'A4', format: 'code128' });
});

it('retains nonempty search paging and sends the next page with its filters', async () => {
  mocks.searchLabelRecords.mockResolvedValue({
    rows: [],
    total: 26,
    page: 1,
    pageSize: 25,
  });
  render(<LabelDesigner {...props} />);
  const next = await screen.findByRole('button', { name: 'Next' });
  expect(next).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.click(next);
  await waitFor(() =>
    expect(mocks.searchLabelRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ ...defaultFilters, page: 2 }),
    ),
  );
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '2 distinct records · 2 labels',
  );
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
  await screen.findByText('1 distinct record · 1 label');
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
  await screen.findByRole('button', { name: 'Review item' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(
    screen.queryByRole('button', { name: 'Review item' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('alert', { name: 'Label item decisions' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Review required before printing'),
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
it('distinguishes same-kind pending additions without internal IDs and removes only the chosen ordinal', async () => {
  const secondId = '00000000-0000-4000-8000-000000000222';
  mocks.query = 'asset=' + secondId;
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue([asset]);
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[
        { kind: 'asset', key: assetId },
        { kind: 'asset', key: secondId },
      ]}
    />,
  );
  const pending = await screen.findByRole('region', {
    name: 'Pending linked additions',
  });
  expect(
    within(pending).getByText('Pending individual asset 1', { exact: true }),
  ).toBeVisible();
  expect(
    within(pending).getByText('Pending individual asset 2', { exact: true }),
  ).toBeVisible();
  expect(pending).not.toHaveTextContent(assetId);
  expect(pending).not.toHaveTextContent(secondId);
  for (const button of within(pending).getAllByRole('button')) {
    expect(button).not.toHaveAccessibleName(
      new RegExp(`${assetId}|${secondId}`),
    );
  }
  await userEvent.setup().click(
    within(pending).getByRole('button', {
      name: 'Remove pending individual asset 2',
    }),
  );
  expect(
    within(pending).getByRole('button', {
      name: 'Remove pending individual asset 1',
    }),
  ).toBeEnabled();
  expect(
    within(pending).queryByText('Pending individual asset 2'),
  ).not.toBeInTheDocument();
  expect(mocks.replace).toHaveBeenLastCalledWith('/labels', {
    scroll: false,
  });
  await act(async () =>
    finish([asset, { ...asset, key: secondId, name: 'Other laptop' }]),
  );
  await screen.findByText('1 distinct record · 1 label');
  const saved = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(saved.entries.map((row: { key: string }) => row.key)).toEqual([
    assetId,
  ]);
});
it('lets the user individually remove an unresolved linked record while preserving another pending addition and its late authorized result', async () => {
  mocks.query =
    'asset=' + assetId + '&quantity=' + quantityId + '&keep=filters';
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValue([quantity]);
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
  await screen.findByText('Adding linked records after restoring this queue…');
  expect(
    screen.getByText('Pending individual asset 1', { exact: true }),
  ).toBeVisible();
  expect(
    screen.getByText('Pending quantity item 2', { exact: true }),
  ).toBeVisible();
  expect(
    screen.queryByText('Pending individual asset: ' + assetId),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Pending quantity item: ' + quantityId),
  ).not.toBeInTheDocument();
  expect(screen.getByText('0 distinct records · 0 labels')).toBeVisible();
  expect(printButton()).toBeDisabled();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Remove pending individual asset 1' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Remove pending individual asset 1' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', {
      name: 'Remove pending quantity item 2',
    }),
  ).toBeEnabled();
  expect(mocks.replace).toHaveBeenLastCalledWith(
    '/labels?quantity=' + quantityId + '&keep=filters',
    { scroll: false },
  );
  await act(async () => finish([asset, quantity]));
  await screen.findByText('1 distinct record · 1 label');
  const saved = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(saved.entries.map((row: { key: string }) => row.key)).toEqual([
    quantityId,
  ]);
  expect(
    screen.queryByRole('region', { name: 'Pending linked additions' }),
  ).not.toBeInTheDocument();
});
it('retains individually cancellable pending rows after a failed linked lookup', async () => {
  mocks.query = 'asset=' + assetId + '&quantity=' + quantityId;
  mocks.getQueueRecords
    .mockRejectedValueOnce(new Error('lookup failed'))
    .mockResolvedValue([quantity]);
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
  await screen.findByRole('button', { name: 'Retry linked additions' });
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: 'Remove pending individual asset 1' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Retry linked additions' }),
  );
  await screen.findByText('1 distinct record · 1 label');
  expect(mocks.getQueueRecords).toHaveBeenCalledWith([
    { kind: 'quantity', key: quantityId },
  ]);
  expect(screen.getAllByRole('button', { name: /^Remove$/ })).toHaveLength(1);
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
  await screen.findByText('1 distinct record · 1 label');
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
  await screen.findByText('1 distinct record · 1 label');
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
  await screen.findByText('1 distinct record · 1 label');
  expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
});
it('removing one historical record preserves the remaining record lifecycle safeguard', async () => {
  const retired = { ...asset, state: 'retired' },
    archived = { ...quantity, state: 'archived' };
  mocks.getQueueRecords.mockResolvedValue([retired, archived]);
  render(<LabelDesigner {...props} initial={[retired, archived]} />);
  await screen.findAllByRole('button', { name: 'Review item' });
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
  expect(screen.getByRole('alert')).toHaveTextContent('Adapters');
  expect(screen.getByRole('alert')).not.toHaveTextContent('Laptop');
  expect(screen.getByRole('button', { name: 'Review item' })).toBeVisible();
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
  expect(screen.getByText('1 distinct record · 1 label')).toBeVisible();
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
    expect(screen.getByText('0 distinct records · 0 labels')).not.toBeVisible();
    expect(mocks.replace).not.toHaveBeenCalled();
    view.unmount();
    render(<LabelDesigner {...props} {...scope} initial={[]} addIntent={[]} />);
    expect(
      await screen.findByText('0 distinct records · 0 labels'),
    ).toBeVisible();
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
  'keeps a changed queue scope masked until a fresh owner entry and ignores a late old search ($memberId, $origin)',
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
    const originalSearch = screen.getByRole('textbox', {
      name: /Name, serial, tag/,
    });
    const restored = { ...defaultFilters, q: 'Current scope' };
    sessionStorage.setItem(
      queueStorageKey(scope.origin, scope.memberId),
      JSON.stringify({ entries: [], filters: restored, job: defaultJob }),
    );
    view.rerender(<LabelDesigner {...props} {...scope} initial={[]} />);
    expect(originalSearch).not.toBeVisible();
    view.unmount();
    render(<LabelDesigner {...props} {...scope} initial={[]} />);
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
      screen.getByText('Shelf 1A · Location · IT Closet / Shelf 1A · Active'),
    ).toBeInTheDocument(),
  );
  expect(
    screen.getByText('Adapters · Uncategorized · ITC-S1A: 3 · Active'),
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

it('revokes same-generation readiness when a card becomes unmeasured and restores it only after remeasurement', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  const sheet = document.querySelector('.label-print-root')!;
  const generation = sheet.getAttribute('data-sheet-generation');
  const card = sheet.querySelector('.label-card')!;
  act(() => {
    card.setAttribute('data-text-measured', 'false');
    card.setAttribute('data-code-ready', 'false');
  });
  await waitFor(() => expect(printButton()).toBeDisabled());
  expect(
    screen.getByText('Preparing codes and layout — printing paused'),
  ).toBeVisible();
  expect(window.print).not.toHaveBeenCalled();
  act(() => {
    card.setAttribute('data-text-measured', 'true');
    card.setAttribute('data-code-ready', 'true');
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(sheet.getAttribute('data-sheet-generation')).toBe(generation);
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
      await screen.findByRole('button', { name: 'Review item' }),
    ).toBeVisible();
    expect(printButton()).toBeDisabled();
    expect(window.print).not.toHaveBeenCalled();
    await reviewAndAcknowledge();
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
  expect(
    await screen.findByText(
      /Some queued records are unavailable to this account/,
    ),
  ).toBeInTheDocument();
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Paper size' }), {
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
  expect(screen.getByRole('combobox', { name: 'Paper size' })).toHaveValue(
    'A4',
  );
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
  expect(screen.getByRole('combobox', { name: 'Paper size' })).toHaveValue(
    'A4',
  );
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
  expect(screen.getByRole('combobox', { name: 'Paper size' })).toBeDisabled();
  expect(screen.getByRole('combobox', { name: 'Barcode type' })).toBeDisabled();
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
    await screen.findByText(
      'Selected records could not be added. Nothing added; try again.',
    ),
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
  expect(
    await screen.findByText(
      /Some queued records are unavailable to this account/,
    ),
  ).toBeInTheDocument();
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
  await reviewAndAcknowledge();
  expect(printButton()).toBeDisabled();
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('requires acknowledgement when Code 128 falls back to QR', async () => {
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Barcode type' }), {
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

it('names the QR fallback when fresh printable content cannot retain Code 128', async () => {
  mocks.getQueueRecords.mockResolvedValue([asset]);
  render(<LabelDesigner {...props} initial={[asset]} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Barcode type' }), {
    target: { value: 'code128' },
  });
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValue([
    { ...asset, name: 'Laptop physical fallback' },
  ]);
  fireEvent.click(printButton());
  expect(
    await screen.findByText(
      'Some Code 128 labels use QR. Acknowledge the QR fallback before printing.',
    ),
  ).toBeVisible();
  expect(window.print).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Acknowledge QR fallback' }),
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
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
  expect(await screen.findByText('Item code: SKU-0042')).toHaveClass(
    'experience-code',
  );
  expect(
    screen.getByText('Active', { selector: '.experience-record-status' }),
  ).toBeVisible();
  expect(screen.queryByText('ID ' + quantityId)).not.toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', {
      name: 'Select Adapters, Quantity item, Shelf 1A',
    }),
  ).not.toHaveAccessibleName(new RegExp(quantityId));
  expect(screen.getByRole('link', { name: 'Adapters' })).toHaveAttribute(
    'href',
    '/inventory/quantity/' + quantityId,
  );
});

it('shows field-aware label-search answers including intentional UUID text without changing selection or printed identity', async () => {
  const result = labelResults([quantity]);
  mocks.searchLabelRecords.mockResolvedValue({
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      customSummary: '[revision internal-field-id] must not render',
      customPreview: {
        answers: [
          {
            label: 'Description',
            type: 'text',
            displayValue: 'Braided cable',
            truncated: false,
          },
          {
            label: 'Department',
            type: 'select_tree',
            displayValue: 'Facilities / East',
            truncated: false,
          },
          {
            label: 'External reference',
            type: 'text',
            displayValue: quantityId,
            truncated: false,
          },
        ],
        truncated: false,
      },
    })),
  });
  mocks.getQueueRecords.mockResolvedValue([quantity]);
  render(<LabelDesigner {...props} initial={[]} />);
  const results = await screen.findByRole('region', {
    name: 'Search result records',
  });
  expect(await within(results).findByText('Braided cable')).toBeVisible();
  expect(within(results).getByText('Description:')).toBeVisible();
  expect(within(results).getByText('Department:')).toBeVisible();
  expect(within(results).getByText('Facilities / East')).toBeVisible();
  expect(within(results).getByText('External reference:')).toBeVisible();
  expect(within(results).getByText(quantityId, { exact: true })).toBeVisible();
  expect(
    within(results).queryByText(/revision internal-field-id/),
  ).not.toBeInTheDocument();
  const details = within(results).getByRole('link', {
    name: 'Full details',
  });
  expect(details).toHaveAttribute('href', '/inventory/quantity/' + quantityId);
  expect(details.closest('label,button')).toBeNull();
  selectRecord(quantity);
  fireEvent.click(
    screen.getByRole('button', { name: 'Add selected to queue' }),
  );
  await screen.findByText('1 distinct record · 1 label');
  expect(mocks.getQueueRecords).toHaveBeenLastCalledWith([
    { kind: 'quantity', key: quantityId },
  ]);
  // The queue text commits before the passive storage effect necessarily runs.
  // Observe persisted identity directly before asserting reload-safe selection.
  await waitFor(() => {
    const stored = JSON.parse(
      sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
    );
    expect(
      stored.entries.map((entry: { kind: string; key: string }) => ({
        kind: entry.kind,
        key: entry.key,
      })),
    ).toEqual([{ kind: 'quantity', key: quantityId }]);
  });
  expect(
    screen.getByRole('region', { name: 'Label queue' }),
  ).not.toHaveTextContent('Braided cable');
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveTextContent(
      quantity.name + ' / ' + quantityId,
    ),
  );
});

it('marks bounded truncated answers and links to the complete asset details', async () => {
  const result = labelResults([asset]);
  mocks.searchLabelRecords.mockResolvedValue({
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      customPreview: {
        answers: [
          {
            label: 'Notes',
            type: 'text',
            displayValue: 'Long answer preview',
            truncated: true,
          },
          {
            label: 'Count',
            type: 'number',
            displayValue: '12',
            truncated: false,
          },
          {
            label: 'Enabled',
            type: 'boolean',
            displayValue: 'Yes',
            truncated: false,
          },
        ],
        truncated: true,
      },
    })),
  });
  render(<LabelDesigner {...props} />);
  const results = await screen.findByRole('region', {
    name: 'Search result records',
  });
  expect(
    await within(results).findByText('Long answer preview…'),
  ).toBeVisible();
  expect(within(results).getByText('12', { exact: true })).toBeVisible();
  expect(within(results).getByText('Yes', { exact: true })).toBeVisible();
  expect(results.querySelectorAll('dt')).toHaveLength(3);
  expect(
    within(results).getByRole('link', {
      name: 'View all details',
    }),
  ).toHaveAttribute('href', '/inventory/assets/' + assetId);
  expect(
    within(results).queryByRole('link', { name: 'Full details' }),
  ).not.toBeInTheDocument();
});

it('omits empty custom previews while retaining the ordinary record detail link', async () => {
  const result = labelResults([quantity]);
  mocks.searchLabelRecords.mockResolvedValue({
    ...result,
    rows: result.rows.map((row) => ({
      ...row,
      customPreview: { answers: [], truncated: false },
    })),
  });
  render(<LabelDesigner {...props} />);
  const results = await screen.findByRole('region', {
    name: 'Search result records',
  });
  expect(
    await within(results).findByRole('link', { name: quantity.name }),
  ).toHaveAttribute('href', '/inventory/quantity/' + quantityId);
  expect(results.querySelector('dl')).toBeNull();
  expect(
    within(results).queryByRole('link', { name: 'Full details' }),
  ).not.toBeInTheDocument();
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

it('shows one named decision on returning to a changed item and invalidates review after successive lifecycle transitions', async () => {
  let current = asset;
  mocks.getQueueRecords.mockImplementation(async () => [quantity, current]);
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  current = { ...asset, state: 'retired' };
  fireEvent(window, new Event('focus'));
  let notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(notice).toHaveTextContent('Laptop');
  expect(notice).toHaveTextContent('Individual asset');
  expect(notice).toHaveTextContent('Lifecycle changed from Active to Retired.');
  expect(
    screen.queryByText('Review required before printing'),
  ).not.toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  let snapshot = within(notice).getByRole('region', { name: 'Review Laptop' });
  expect(snapshot).toHaveTextContent('Current authorized snapshot: Retired');
  expect(
    within(snapshot).getByRole('link', { name: 'View item details' }),
  ).toHaveAttribute('href', asset.path);
  expect(
    within(snapshot).getByRole('button', { name: 'Acknowledge reviewed item' }),
  ).toBeDisabled();
  expect(printButton()).toBeDisabled();
  fireEvent.click(within(snapshot).getByRole('checkbox'));
  fireEvent.click(
    within(snapshot).getByRole('button', { name: 'Acknowledge reviewed item' }),
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
  current = asset;
  fireEvent(window, new Event('focus'));
  notice = await screen.findByRole('alert', { name: 'Label item decisions' });
  expect(notice).toHaveTextContent('Lifecycle changed from Retired to Active.');
  expect(within(notice).queryByRole('region')).not.toBeInTheDocument();
  await reviewAndAcknowledge();
  await waitFor(() => expect(printButton()).toBeEnabled());
  current = { ...asset, state: 'retired' };
  fireEvent(window, new Event('focus'));
  notice = await screen.findByRole('alert', { name: 'Label item decisions' });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  snapshot = within(notice).getByRole('region', { name: 'Review Laptop' });
  expect(within(snapshot).getByRole('checkbox')).not.toBeChecked();
  expect(
    within(snapshot).getByRole('button', { name: 'Acknowledge reviewed item' }),
  ).toBeDisabled();
  expect(printButton()).toBeDisabled();
  expect(window.print).not.toHaveBeenCalled();
});

it('requires fresh review when the acknowledgment read returns a different tag or lifecycle', async () => {
  let current = { ...asset, state: 'retired' };
  mocks.getQueueRecords.mockImplementation(async () => [current]);
  render(<LabelDesigner {...props} initial={[asset]} />);
  let notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  fireEvent.click(within(notice).getByRole('checkbox'));
  current = { ...asset, state: 'active', tag: 'lap-002', barcode: 'lap-002' };
  fireEvent.click(
    within(notice).getByRole('button', { name: 'Acknowledge reviewed item' }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Review Laptop' }),
    ).not.toBeInTheDocument(),
  );
  notice = screen.getByRole('alert', { name: 'Label item decisions' });
  expect(notice).toHaveTextContent('Current state: Active.');
  expect(notice).toHaveTextContent('Identifier changed.');
  expect(printButton()).toBeDisabled();
  const stored = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(stored.entries[0].baselineTag).toBe('lap-001');
  expect(stored.entries[0].baselineState).toBe('active');
  await reviewAndAcknowledge();
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('reviews affected items individually while preserving unrelated copies and print settings', async () => {
  const retired = { ...asset, state: 'retired' };
  const archived = { ...quantity, state: 'archived' };
  mocks.getQueueRecords.mockResolvedValue([retired, archived]);
  render(<LabelDesigner {...props} initial={[asset, quantity]} />);
  await screen.findAllByRole('button', { name: 'Review item' });
  fireEvent.change(screen.getAllByRole('spinbutton', { name: 'Copies' })[1], {
    target: { value: '3' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: 'Paper size' }), {
    target: { value: 'A4' },
  });
  await reviewAndAcknowledge('Laptop');
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Review item' })).toHaveLength(
      1,
    ),
  );
  expect(
    screen.getByRole('alert', { name: 'Label item decisions' }),
  ).toHaveTextContent('Adapters');
  expect(
    screen.getByRole('alert', { name: 'Label item decisions' }),
  ).not.toHaveTextContent('Laptop');
  expect(printButton()).toBeDisabled();
  expect(screen.getAllByRole('spinbutton', { name: 'Copies' })[1]).toHaveValue(
    3,
  );
  expect(screen.getByRole('combobox', { name: 'Paper size' })).toHaveValue(
    'A4',
  );
  await reviewAndAcknowledge('Adapters');
  await waitFor(() => expect(printButton()).toBeEnabled());
});

it('does not resurrect a removed final entry or its lifecycle warning from a delayed focus refresh', async () => {
  mocks.getQueueRecords.mockResolvedValue([asset]);
  const view = render(<LabelDesigner {...props} initial={[asset]} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  await act(async () => finish([{ ...asset, state: 'retired' }]));
  expect(screen.getByText('0 distinct records · 0 labels')).toBeInTheDocument();
  expect(
    screen.queryByRole('alert', { name: 'Label item decisions' }),
  ).not.toBeInTheDocument();
  expect(document.querySelectorAll('.label-card')).toHaveLength(0);
  expect(printButton()).toBeDisabled();
  view.unmount();
  render(<LabelDesigner {...props} initial={[]} />);
  expect(
    await screen.findByText('0 distinct records · 0 labels'),
  ).toBeVisible();
  expect(
    screen.queryByRole('alert', { name: 'Label item decisions' }),
  ).not.toBeInTheDocument();
});

it('clears formerly readable names and sheet content when a reviewed item becomes inaccessible', async () => {
  mocks.getQueueRecords.mockResolvedValue([asset]);
  render(<LabelDesigner {...props} initial={[asset]} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValue([{ ...asset, state: 'retired' }]);
  fireEvent(window, new Event('focus'));
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  fireEvent.click(within(notice).getByRole('checkbox'));
  mocks.getQueueRecords.mockResolvedValue([]);
  fireEvent.click(
    within(notice).getByRole('button', { name: 'Acknowledge reviewed item' }),
  );
  await screen.findByText(
    /Some queued records are unavailable to this account/,
  );
  expect(screen.queryByText(/Laptop/)).not.toBeInTheDocument();
  expect(
    screen.queryByRole('alert', { name: 'Label item decisions' }),
  ).not.toBeInTheDocument();
  expect(document.querySelectorAll('.label-card')).toHaveLength(0);
  expect(printButton()).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove unavailable item from queue' }),
  );
  expect(screen.getByText('0 distinct records · 0 labels')).toBeInTheDocument();
  expect(
    screen.queryByText(/Some queued records are unavailable/),
  ).not.toBeInTheDocument();
});

it('does not retain a checkbox decision across collapse, focus refresh or screen reentry', async () => {
  const retired = { ...asset, state: 'retired' };
  mocks.getQueueRecords.mockResolvedValue([retired]);
  const view = render(<LabelDesigner {...props} initial={[asset]} />);
  let notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  fireEvent.click(within(notice).getByRole('checkbox'));
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  expect(within(notice).queryByRole('region')).not.toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  expect(within(notice).getByRole('checkbox')).not.toBeChecked();
  fireEvent(window, new Event('focus'));
  expect(printButton()).toBeDisabled();
  await waitFor(() =>
    expect(
      within(
        screen.getByRole('alert', { name: 'Label item decisions' }),
      ).getByRole('button', { name: 'Review item' }),
    ).toBeEnabled(),
  );
  expect(
    screen.queryByRole('region', { name: 'Review Laptop' }),
  ).not.toBeInTheDocument();
  view.unmount();
  render(<LabelDesigner {...props} initial={[]} />);
  notice = await screen.findByRole('alert', { name: 'Label item decisions' });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  expect(within(notice).getByRole('checkbox')).not.toBeChecked();
  expect(printButton()).toBeDisabled();
});

it('rejects a delayed acknowledgment after focus advances the queue validation generation', async () => {
  const retired = { ...asset, state: 'retired' };
  mocks.getQueueRecords.mockResolvedValue([retired]);
  render(<LabelDesigner {...props} initial={[asset]} />);
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  fireEvent.click(within(notice).getByRole('checkbox'));
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(
    within(notice).getByRole('button', { name: 'Acknowledge reviewed item' }),
  );
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2));
  mocks.getQueueRecords.mockResolvedValue([asset]);
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(3));
  await act(async () => finish([retired]));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Review item' })).toBeEnabled(),
  );
  expect(printButton()).toBeDisabled();
  const stored = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(stored.entries[0].baselineState).toBe('active');
  expect(stored.entries[0].lifecycleAcknowledged).toBe(false);
  expect(
    screen.getByRole('alert', { name: 'Label item decisions' }),
  ).toHaveTextContent('Current state: Active.');
  expect(
    screen.queryByText(/Current authorized snapshot: Retired/),
  ).not.toBeInTheDocument();
  await reviewAndAcknowledge();
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it.each([false, true])(
  'keeps only an unchanged surviving historical review after removal and authorized revalidation (changed survivor: %s)',
  async (changed) => {
    const retired = { ...asset, state: 'retired' };
    const archived = { ...quantity, state: 'archived' };
    mocks.getQueueRecords.mockResolvedValue([retired, archived]);
    render(<LabelDesigner {...props} initial={[asset, quantity]} />);
    const notice = await screen.findByRole('alert', {
      name: 'Label item decisions',
    });
    const row = within(notice).getByRole('heading', {
      name: /^Adapters/,
    }).parentElement!;
    fireEvent.click(within(row).getByRole('button', { name: 'Review item' }));
    fireEvent.click(within(row).getByRole('checkbox'));
    let finish!: (rows: LiveLabel[]) => void;
    mocks.getQueueRecords.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      within(
        within(notice).getByRole('heading', { name: /^Laptop/ }).parentElement!,
      ).getByRole('button', { name: 'Remove from queue' }),
    );
    // Remove using its explicit row action, not an acknowledgment or print path.
    await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2));
    expect(within(row).getByRole('checkbox')).toBeChecked();
    expect(
      within(row).getByRole('button', { name: 'Acknowledge reviewed item' }),
    ).toBeDisabled();
    await act(async () =>
      finish([{ ...archived, ...(changed ? { state: 'active' } : {}) }]),
    );
    if (changed) {
      await waitFor(() =>
        expect(
          screen.queryByRole('region', { name: 'Review Adapters' }),
        ).not.toBeInTheDocument(),
      );
      expect(
        screen.getByRole('alert', { name: 'Label item decisions' }),
      ).toHaveTextContent('Current state: Active');
    } else {
      await waitFor(() =>
        expect(
          within(row).getByRole('button', {
            name: 'Acknowledge reviewed item',
          }),
        ).toBeEnabled(),
      );
      expect(within(row).getByRole('checkbox')).toBeChecked();
    }
    expect(
      screen.getByRole('alert', { name: 'Label item decisions' }),
    ).not.toHaveTextContent('Laptop');
    expect(printButton()).toBeDisabled();
    expect(window.print).not.toHaveBeenCalled();
  },
);

it('persists outstanding review when an observed retirement returns to active before acknowledgment', async () => {
  let current = asset;
  mocks.getQueueRecords.mockImplementation(async () => [current]);
  const view = render(<LabelDesigner {...props} initial={[asset]} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  current = { ...asset, state: 'retired' };
  fireEvent(window, new Event('focus'));
  await screen.findByRole('alert', { name: 'Label item decisions' });
  current = asset;
  fireEvent(window, new Event('focus'));
  await waitFor(() =>
    expect(
      screen.getByRole('alert', { name: 'Label item decisions' }),
    ).toHaveTextContent('Current state: Active.'),
  );
  expect(printButton()).toBeDisabled();
  await waitFor(() =>
    expect(
      JSON.parse(
        sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
      ).entries[0].lifecycleAcknowledged,
    ).toBe(false),
  );
  view.unmount();
  render(<LabelDesigner {...props} initial={[]} />);
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  expect(notice).toHaveTextContent('Current state: Active.');
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  expect(within(notice).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  fireEvent.click(
    within(notice).getByRole('button', { name: 'Acknowledge reviewed item' }),
  );
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('latches another item changed in an acknowledgment read even when it restores before the next refresh', async () => {
  const archived = { ...quantity, state: 'archived' };
  const retired = { ...asset, state: 'retired' };
  mocks.getQueueRecords.mockResolvedValue([archived, asset]);
  render(<LabelDesigner {...props} initial={[archived, asset]} />);
  await screen.findByRole('alert', { name: 'Label item decisions' });
  mocks.getQueueRecords.mockResolvedValueOnce([archived, retired]);
  await reviewAndAcknowledge('Adapters');
  await waitFor(() =>
    expect(
      screen.getByRole('alert', { name: 'Label item decisions' }),
    ).toHaveTextContent('Laptop'),
  );
  const notice = screen.getByRole('alert', { name: 'Label item decisions' });
  expect(notice).toHaveTextContent('Current state: Active.');
  expect(notice).not.toHaveTextContent('Adapters');
  await waitFor(() => {
    const stored = JSON.parse(
      sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
    );
    expect(
      stored.entries.find((entry: { key: string }) => entry.key === assetId)
        .lifecycleAcknowledged,
    ).toBe(false);
  });
  expect(printButton()).toBeDisabled();
  await reviewAndAcknowledge('Laptop');
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('retains a surviving item lifecycle observation beside a missing sibling through removal and restoration', async () => {
  mocks.getQueueRecords.mockResolvedValue([quantity, asset]);
  render(<LabelDesigner {...props} />);
  await waitFor(() => expect(printButton()).toBeEnabled());
  mocks.getQueueRecords.mockResolvedValueOnce([{ ...asset, state: 'retired' }]);
  fireEvent(window, new Event('focus'));
  await screen.findByText(
    /Some queued records are unavailable to this account/,
  );
  mocks.getQueueRecords.mockResolvedValue([asset]);
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove unavailable item from queue' }),
  );
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  expect(notice).toHaveTextContent('Laptop');
  expect(notice).toHaveTextContent('Current state: Active.');
  expect(
    screen.queryByText(/Some queued records are unavailable/),
  ).not.toBeInTheDocument();
  expect(screen.getByText('1 distinct record · 1 label')).toBeInTheDocument();
  const stored = JSON.parse(
    sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
  );
  expect(stored.entries[0].key).toBe(assetId);
  expect(stored.entries[0].lifecycleAcknowledged).toBe(false);
  expect(printButton()).toBeDisabled();
  await reviewAndAcknowledge('Laptop');
  await waitFor(() => expect(printButton()).toBeEnabled());
  expect(window.print).not.toHaveBeenCalled();
});

it('invalidates an already latched checked review immediately when a duplicate linked lookup observes a new snapshot', async () => {
  const retired = { ...asset, state: 'retired' };
  mocks.getQueueRecords.mockResolvedValue([retired]);
  const view = render(<LabelDesigner {...props} initial={[retired]} />);
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  fireEvent.click(within(notice).getByRole('button', { name: 'Review item' }));
  fireEvent.click(within(notice).getByRole('checkbox'));
  expect(
    within(notice).getByRole('button', { name: 'Acknowledge reviewed item' }),
  ).toBeEnabled();
  let finish!: (rows: LiveLabel[]) => void;
  const delayed = new Promise<LiveLabel[]>((resolve) => {
    finish = resolve;
  });
  mocks.getQueueRecords
    .mockResolvedValue([asset])
    .mockImplementationOnce(() => delayed);
  mocks.query = 'asset=' + assetId;
  view.rerender(
    <LabelDesigner
      {...props}
      initial={[retired]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  await screen.findByText('Adding linked records after restoring this queue…');
  await act(async () => finish([asset]));
  expect(
    screen.queryByRole('region', { name: 'Review Laptop' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Acknowledge reviewed item' }),
  ).not.toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  await waitFor(() =>
    expect(
      screen.getByRole('alert', { name: 'Label item decisions' }),
    ).toHaveTextContent('Lifecycle changed from Retired to Active.'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review item' }));
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: 'Review Laptop' }),
  ).toHaveTextContent('Current authorized snapshot: Active');
  expect(window.print).not.toHaveBeenCalled();
});

it('retains review debt when an overlapping manual lookup observes a second change after a linked add', async () => {
  const retired = { ...asset, state: 'retired' };
  mocks.query = 'asset=' + assetId;
  mocks.searchLabelRecords.mockResolvedValue({
    rows: [
      {
        kind: 'asset',
        key: assetId,
        name: asset.name,
        categoryName: 'Computers',
        status: 'active',
        assetTag: asset.tag,
        itemCode: null,
        serialNumber: null,
        manufacturer: null,
        model: null,
        holdingContext: asset.holdingContext,
      },
    ],
    total: 1,
    page: 1,
    pageSize: 25,
  });
  let finishLinked!: (rows: LiveLabel[]) => void;
  let finishManual!: (rows: LiveLabel[]) => void;
  const linked = new Promise<LiveLabel[]>((resolve) => {
    finishLinked = resolve;
  });
  const manual = new Promise<LiveLabel[]>((resolve) => {
    finishManual = resolve;
  });
  mocks.getQueueRecords
    .mockResolvedValue([retired])
    .mockImplementationOnce(() => linked)
    .mockImplementationOnce(() => manual);
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      addIntent={[{ kind: 'asset', key: assetId }]}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }));
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledTimes(2));
  await act(async () => finishLinked([retired]));
  const notice = await screen.findByRole('alert', {
    name: 'Label item decisions',
  });
  expect(
    within(notice).getByRole('button', { name: 'Review item' }),
  ).toBeDisabled();
  mocks.getQueueRecords.mockResolvedValue([asset]);
  await act(async () => finishManual([asset]));
  expect(
    screen.queryByRole('region', { name: 'Review Laptop' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Acknowledge reviewed item' }),
  ).not.toBeInTheDocument();
  expect(printButton()).toBeDisabled();
  await waitFor(() =>
    expect(
      screen.getByRole('alert', { name: 'Label item decisions' }),
    ).toHaveTextContent('Lifecycle changed from Retired to Active.'),
  );
  expect(screen.getByText('1 distinct record · 1 label')).toBeVisible();
  expect(window.print).not.toHaveBeenCalled();
});

it.each([
  ['quantity', 'Quantity item', quantityId, 'Cables'],
  ['asset', 'Individual asset', assetId, 'Computers'],
] as const)(
  'labels ordinary search kinds as %s without changing record routes',
  async (kind, display, key, categoryName) => {
    mocks.searchLabelRecords.mockResolvedValueOnce({
      rows: [
        {
          kind,
          key,
          name: 'Type presentation record',
          categoryName,
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
    const result = await screen.findByRole('link', {
      name: 'Type presentation record',
    });
    expect(result).toHaveAttribute(
      'href',
      `/inventory/${kind === 'asset' ? 'assets' : 'quantity'}/${key}`,
    );
    const results = screen.getByRole('region', {
      name: 'Search result records',
    });
    expect(
      within(results).getByText(`${display} · ${categoryName} ·`, {
        exact: false,
      }),
    ).toHaveTextContent(`${display} · ${categoryName} · Active`);
    expect(
      within(results).queryByText(`${kind} · ${categoryName} · Active`),
    ).toBeNull();
  },
);

function labelResults(
  rows: LiveLabel[],
  page = 1,
  total = rows.length,
  pageSize = 25,
) {
  return {
    rows: rows.map((row) => ({
      kind: row.kind as 'quantity' | 'asset',
      key: row.key,
      name: row.name,
      categoryName: row.categoryName ?? '',
      status: row.state,
      assetTag: row.tag,
      itemCode: row.humanId ?? null,
      serialNumber: null,
      manufacturer: null,
      model: null,
      holdingContext: row.holdingContext,
    })),
    total,
    page,
    pageSize,
  };
}
function selectRecord(row: LiveLabel) {
  fireEvent.click(
    screen.getByRole('checkbox', {
      name: `Select ${row.name}, ${row.kind === 'quantity' ? 'Quantity item' : 'Individual asset'}, ${row.holdingContext}`,
    }),
  );
}

it('shows immediate single-add state and nearby live feedback through removal and re-add', async () => {
  mocks.searchLabelRecords.mockResolvedValue(labelResults([quantity]));
  mocks.getQueueRecords.mockResolvedValue([quantity]);
  render(<LabelDesigner {...props} initial={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add to queue' }));
  expect(
    await screen.findByRole('button', { name: 'In queue' }),
  ).toBeDisabled();
  expect(
    screen.getByRole('link', { name: 'Review queue: 1 record \u00b7 1 label' }),
  ).toHaveAttribute('href', '#label-queue');
  expect(
    screen.getByText(/^Added: Adapters/).closest('[role="status"]'),
  ).toHaveAttribute('aria-live', 'polite');
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  expect(screen.getByRole('button', { name: 'Add to queue' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to queue' }));
  expect(
    await screen.findByRole('button', { name: 'In queue' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear queue' }));
  expect(
    screen.getByRole('link', {
      name: 'Review queue: 0 records \u00b7 0 labels',
    }),
  ).toBeVisible();
});

it('retains explicit selections across pages with named added, present and unavailable results', async () => {
  const missing = {
    ...quantity,
    key: '00000000-0000-4000-8000-000000000003',
    name: 'Missing adapters',
  };
  mocks.searchLabelRecords.mockImplementation((filters) =>
    Promise.resolve(
      filters.page === 1
        ? labelResults([quantity, missing], 1, 4, 2)
        : labelResults([quantity, asset], 2, 4, 2),
    ),
  );
  mocks.getQueueRecords.mockImplementation((keys: { key: string }[]) =>
    Promise.resolve(
      [quantity, asset].filter((row) =>
        keys.some((key) => key.key === row.key),
      ),
    ),
  );
  render(<LabelDesigner {...props} initial={[quantity]} />);
  await screen.findByRole('button', { name: 'In queue' });
  fireEvent.click(screen.getByRole('button', { name: 'Select current page' }));
  expect(screen.getByText('2 selected records')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('checkbox', {
    name: /Select Laptop, Individual asset,/,
  });
  expect(
    screen.getByRole('checkbox', {
      name: /Select Adapters, Quantity item,/,
    }),
  ).toBeChecked();
  selectRecord(asset);
  fireEvent.click(
    screen.getByRole('button', { name: 'Add selected to queue' }),
  );
  const feedback = await screen.findByText(
    'Added: Laptop (Individual asset). Already present: Adapters (Quantity item). Unavailable to this account: Missing adapters (Quantity item).',
  );
  expect(feedback).toBeVisible();
  expect(feedback.closest('[role="status"]')).not.toHaveTextContent(asset.key);
  expect(feedback.closest('[role="status"]')).not.toHaveTextContent(
    quantity.key,
  );
  expect(feedback.closest('[role="status"]')).not.toHaveTextContent(
    missing.key,
  );
  expect(screen.getByText('0 selected records')).toBeVisible();
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '2 distinct records \u00b7 2 labels',
  );
});

it('distinguishes same-name quantity batch feedback using freshly resolved item codes while preserving typed queue identities', async () => {
  const already = { ...quantity, humanId: 'ADP-USB' };
  const added = {
    ...quantity,
    key: '00000000-0000-4000-8000-000000000004',
    humanId: 'ADP-HDMI',
    holdingContext: 'ITC-S1B: 2',
  };
  const search = labelResults([already, added]);
  search.rows[0].itemCode = 'OLD-USB';
  search.rows[1].itemCode = 'OLD-HDMI';
  mocks.searchLabelRecords.mockResolvedValue(search);
  mocks.getQueueRecords.mockImplementation((keys: { key: string }[]) =>
    Promise.resolve(
      [already, added].filter((row) => keys.some((key) => key.key === row.key)),
    ),
  );
  render(<LabelDesigner {...props} initial={[already]} />);
  await screen.findByRole('button', { name: 'In queue' });
  fireEvent.click(screen.getByRole('button', { name: 'Select current page' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Add selected to queue' }),
  );
  const feedback = await screen.findByText(
    'Added: Adapters (Quantity item; item code ADP-HDMI). Already present: Adapters (Quantity item; item code ADP-USB). Unavailable to this account: none.',
  );
  expect(feedback.closest('[role="status"]')).not.toHaveTextContent(
    already.key,
  );
  expect(feedback.closest('[role="status"]')).not.toHaveTextContent(added.key);
  expect(feedback.closest('[role="status"]')).not.toHaveTextContent('OLD-');
  await waitFor(() =>
    expect(
      JSON.parse(
        sessionStorage.getItem(queueStorageKey(props.origin, props.memberId))!,
      ).entries.map(
        ({
          kind,
          key,
          copies,
        }: {
          kind: string;
          key: string;
          copies: number;
        }) => ({ kind, key, copies }),
      ),
    ).toEqual([
      { kind: 'quantity', key: already.key, copies: 1 },
      { kind: 'quantity', key: added.key, copies: 1 },
    ]),
  );
});

it('cancels delayed batches on filter change and prevents rapid duplicate submissions', async () => {
  mocks.searchLabelRecords.mockResolvedValue(labelResults([quantity, asset]));
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementation(
    () =>
      new Promise<LiveLabel[]>((resolve) => {
        finish = resolve;
      }),
  );
  render(<LabelDesigner {...props} initial={[]} />);
  await screen.findByRole('checkbox', { name: new RegExp('^Select Adapters') });
  fireEvent.click(screen.getByRole('button', { name: 'Select current page' }));
  const add = screen.getByRole('button', { name: 'Add selected to queue' });
  fireEvent.click(add);
  fireEvent.click(add);
  expect(mocks.getQueueRecords).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('combobox', { name: 'Type' }), {
    target: { value: 'quantity' },
  });
  expect(screen.getByText(/Unsubmitted label selection cleared/)).toBeVisible();
  await act(async () => finish([quantity, asset]));
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '0 distinct records',
  );
  expect(screen.getByText('0 selected records')).toBeVisible();
});

it('discards a delayed selected addition on actor or environment replacement', async () => {
  mocks.searchLabelRecords.mockResolvedValue(labelResults([quantity]));
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockImplementation(
    () =>
      new Promise<LiveLabel[]>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<LabelDesigner {...props} initial={[]} />);
  await screen.findByRole('checkbox', { name: new RegExp('^Select Adapters') });
  fireEvent.click(screen.getByRole('button', { name: 'Select current page' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Add selected to queue' }),
  );
  view.rerender(
    <LabelDesigner
      {...props}
      initial={[]}
      memberId="member-b"
      origin="https://other.example.test"
    />,
  );
  await act(async () => finish([quantity]));
  expect(
    view.container.querySelector('[aria-label="Label queue"]'),
  ).not.toBeVisible();
  view.unmount();
  render(
    <LabelDesigner
      {...props}
      initial={[]}
      memberId="member-b"
      origin="https://other.example.test"
    />,
  );
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '0 distinct records',
  );
});

it('keeps batch historical additions behind the existing lifecycle review', async () => {
  const archived = { ...quantity, state: 'archived' };
  mocks.searchLabelRecords.mockResolvedValue(labelResults([archived]));
  mocks.getQueueRecords.mockResolvedValue([archived]);
  render(<LabelDesigner {...props} initial={[]} />);
  await screen.findByRole('checkbox', { name: new RegExp('^Select Adapters') });
  fireEvent.click(screen.getByRole('button', { name: 'Select current page' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Add selected to queue' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Review item' }),
  ).toBeVisible();
  expect(printButton()).toBeDisabled();
});
it('defers label restoration and changed-actor bootstrap while privacy verification is pending', async () => {
  const { PrivacyReadinessContext } =
    await import('@/components/auth/privacy-readiness');
  const get = vi.spyOn(Storage.prototype, 'getItem');
  const view = render(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <LabelDesigner {...props} />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  expect(mocks.getQueueRecords).not.toHaveBeenCalled();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: true, generation: 'first' }}>
      <LabelDesigner {...props} />
    </PrivacyReadinessContext>,
  );
  await screen.findByRole('region', { name: 'Label queue' });
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith(
      queueStorageKey(props.origin, props.memberId),
    ),
  );
  get.mockClear();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <LabelDesigner {...props} />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: true, generation: 'first' }}>
      <LabelDesigner {...props} />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  view.rerender(
    <PrivacyReadinessContext value={{ ready: false, generation: 'first' }}>
      <LabelDesigner {...props} memberId="other-actor" />
    </PrivacyReadinessContext>,
  );
  expect(get).not.toHaveBeenCalled();
  expect(
    screen.queryByRole('region', { name: 'Label queue' }),
  ).not.toBeInTheDocument();
  get.mockRestore();
});
it.each(['retry', 'first attempt'] as const)(
  'resets a mounted populated label queue after same-generation SIGNED_OUT cleanup succeeds on %s',
  async (mode) => {
    const generation = '00000000-0000-4000-8000-000000000001';
    const key = queueStorageKey(props.origin, props.memberId);
    mocks.getQueueRecords.mockResolvedValue([asset]);
    sessionStorage.setItem(logoutAcknowledgementKey, generation);
    sessionStorage.setItem(
      key,
      JSON.stringify({
        entries: [
          {
            kind: asset.kind,
            key: asset.key,
            copies: 4,
            baselineTag: asset.tag,
            baselineState: asset.state,
            lifecycleAcknowledged: true,
          },
        ],
        filters: defaultFilters,
        job: { ...defaultJob, layout: { version: 999 } },
        mediaDraft: { mode: 'single', labelWidth: '90.', labelHeight: '50' },
        copyDrafts: { [`asset:${assetId}`]: '101' },
      }),
    );
    mocks.readLogoutPrivacyGeneration.mockResolvedValue({
      status: 'valid',
      generation,
    });
    mocks.readProtectedPrivacyIdentity.mockResolvedValue({
      status: 'match',
      generation: { status: 'valid', generation },
    });
    render(
      <ProtectedPrivacyBoundary
        binding={{
          actorId: props.memberId,
          backend: 'https://isolated.supabase.co',
          role: 'staff',
          canManageConfiguration: true,
        }}
      >
        <AssignmentScopeGuard
          actorId={props.memberId}
          backend="https://isolated.supabase.co"
        />
        <LabelDesigner {...props} initial={[]} />
      </ProtectedPrivacyBoundary>,
    );
    await screen.findByText('1 distinct record · 4 labels');
    expect(screen.getByRole('spinbutton', { name: 'Copies' })).toHaveValue(101);
    expect(printButton()).toBeDisabled();
    const remove = Storage.prototype.removeItem;
    const denied = vi
      .spyOn(Storage.prototype, 'removeItem')
      .mockImplementation(function (this: Storage, target) {
        if (mode === 'retry' && target === key) return;
        remove.call(this, target);
      });
    const persist = vi.spyOn(Storage.prototype, 'setItem');
    mocks.readLogoutPrivacyGeneration.mockClear();
    mocks.readLogoutPrivacyGeneration.mockImplementation(async () => {
      // Bound a runaway retry so this regression fails without exhausting memory.
      if (mocks.readLogoutPrivacyGeneration.mock.calls.length > 8)
        throw new Error(
          'Privacy verification retried without an external trigger',
        );
      return { status: 'valid', generation };
    });
    act(() => mocks.authChanged?.('SIGNED_OUT', null));
    if (mode === 'retry') {
      expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBe('all');
      act(() => window.dispatchEvent(new Event('focus')));
      await screen.findByRole('alert');
      expect(
        mocks.readLogoutPrivacyGeneration.mock.calls.length,
      ).toBeLessThanOrEqual(3);
      denied.mockRestore();
      persist.mockClear();
      fireEvent.click(
        screen.getByRole('button', { name: 'Retry privacy cleanup' }),
      );
    } else {
      expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
      // No marker remains for this matching-generation recheck to notice.
      act(() => window.dispatchEvent(new Event('focus')));
    }
    await screen.findByText('0 distinct records · 0 labels');
    expect(
      within(screen.getByRole('region', { name: 'Label queue' })).queryByText(
        /Laptop/,
      ),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(key)!).entries).toEqual([]),
    );
    for (const [target, value] of persist.mock.calls)
      if (target === key) {
        const stored = JSON.parse(value);
        expect(stored.entries).toEqual([]);
        expect(stored.copyDrafts).toEqual({});
        expect(stored.mediaDraft).toBeUndefined();
        expect(stored.job).toEqual(defaultJob);
      }
    expect(sessionStorage.getItem(logoutAcknowledgementKey)).toBe(generation);
    expect(sessionStorage.getItem('inventory-assign-cleanup-v1')).toBeNull();
  },
);
it('rejects persistence from a late old-instance refresh after cleanup before the readiness reset commits', async () => {
  const { PrivacyReadinessContext } =
    await import('@/components/auth/privacy-readiness');
  const revision = readAuthoritativeCleanupRevision();
  const key = queueStorageKey(props.origin, props.memberId);
  sessionStorage.setItem(
    key,
    JSON.stringify({
      entries: [
        {
          kind: asset.kind,
          key: asset.key,
          copies: 4,
          baselineTag: asset.tag,
          baselineState: asset.state,
          lifecycleAcknowledged: true,
        },
      ],
      filters: defaultFilters,
      job: defaultJob,
    }),
  );
  let finish!: (rows: LiveLabel[]) => void;
  mocks.getQueueRecords.mockReturnValueOnce(
    new Promise<LiveLabel[]>((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    <PrivacyReadinessContext
      value={{ ready: true, generation: 'same', cleanupRevision: revision }}
    >
      <LabelDesigner {...props} initial={[]} />
    </PrivacyReadinessContext>,
  );
  await waitFor(() => expect(mocks.getQueueRecords).toHaveBeenCalledOnce());
  expect(screen.getByRole('region', { name: 'Label queue' })).toHaveTextContent(
    '1 distinct record · 4 labels',
  );
  // Model a queued refresh resolving before React commits the provider's reset.
  act(() => {
    expect(invalidateAssignmentPrivacy(true)).toBe(true);
  });
  expect(sessionStorage.getItem(key)).toBeNull();
  await act(async () => finish([{ ...asset, tag: 'changed-after-request' }]));
  expect(sessionStorage.getItem(key)).toBeNull();
  view.rerender(
    <PrivacyReadinessContext
      value={{
        ready: true,
        generation: 'same',
        cleanupRevision: readAuthoritativeCleanupRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <LabelDesigner {...props} initial={[]} />
    </PrivacyReadinessContext>,
  );
  await screen.findByText('0 distinct records · 0 labels');
  await waitFor(() =>
    expect(JSON.parse(sessionStorage.getItem(key)!).entries).toEqual([]),
  );
});
