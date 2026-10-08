import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustodyChangeForm } from './custody-change-form';
import { submitCustody } from './actions';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ submitCustody: vi.fn() }));
vi.mock('@/features/locations/location-picker', () => ({
  LocationPicker: ({
    label,
    onValueChange,
  }: {
    label: string;
    onValueChange: (value: string) => void;
  }) => (
    <button
      type="button"
      onClick={() => onValueChange('00000000-0000-4000-8000-000000000002')}
    >
      {label}
    </button>
  ),
}));
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const location = {
  id: id(2),
  code: 'ITO-GENERAL',
  name: 'General Storage / Unsorted',
  breadcrumb: 'IT Office / General Storage / Unsorted',
  active: true,
  can_hold_inventory: true,
  parentId: id(9),
};
const site = {
  id: id(4),
  code: 'PROPERTY-A',
  name: 'Example Property',
  notes: null,
  active: true,
  version: '1',
};
const otherSite = {
  ...site,
  id: id(5),
  code: 'PROPERTY-B',
  name: 'Other Property',
};
beforeEach(() => vi.mocked(submitCustody).mockReset());

it('explains absent sites and disables only the unavailable assignment', () => {
  render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[]}
      currentLocation={location}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  ).toBeDisabled();
  expect(screen.getByText(/No sites are configured/)).toBeVisible();
  expect(screen.queryByRole('link', { name: /site settings/i })).toBeNull();
  expect(submitCustody).not.toHaveBeenCalled();
});

it('offers existing site settings only to a maintainer and distinguishes inactive configuration', () => {
  const view = render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[]}
      currentLocation={location}
      canManageConfiguration
    />,
  );
  expect(
    screen.getByRole('link', { name: 'Open site settings' }),
  ).toHaveAttribute('href', '/settings/sites');
  view.rerender(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[{ ...site, active: false }]}
      currentLocation={location}
    />,
  );
  expect(screen.getByText(/No active sites/)).toBeVisible();
  expect(screen.queryByText(/No sites are configured/)).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open site settings' })).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  ).toBeDisabled();
});

it('distinguishes a transfer with no other destination and leaves an archived-site return available', () => {
  const view = render(
    <CustodyChangeForm
      kind="asset"
      action="transfer"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[site]}
      currentSite={site}
    />,
  );
  expect(screen.getByText(/No other active site/)).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Review transfer between sites' }),
  ).toBeDisabled();
  view.rerender(
    <CustodyChangeForm
      kind="asset"
      action="return"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[{ ...site, active: false }]}
      currentSite={site}
    />,
  );
  expect(
    screen
      .getAllByRole('button', { name: 'Review return to storage' })
      .find((button) => button.getAttribute('type') === 'submit'),
  ).toBeEnabled();
  expect(screen.queryByText(/No active sites/)).toBeNull();
});

it('collects destination and overdraw together and clears only corrected issues without moving focus', () => {
  render(
    <CustodyChangeForm
      kind="quantity"
      action="issue"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[site]}
      storageBalances={[{ location, quantity: 3 }]}
    />,
  );
  const amount = screen.getByLabelText('Units');
  fireEvent.change(amount, { target: { value: '4' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review issue stock to a site' }),
  );
  expect(screen.getByRole('link', { name: 'Destination site' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Units' })).toBeVisible();
  amount.focus();
  fireEvent.change(amount, { target: { value: '2' } });
  expect(amount).toHaveFocus();
  expect(screen.queryByRole('link', { name: 'Units' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Destination site' })).toBeVisible();
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: site.id },
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(submitCustody).not.toHaveBeenCalled();
});

it('invalidates custody review after an edit or an observed catalog change, even when that catalog returns', () => {
  const props = {
    kind: 'asset' as const,
    action: 'assign' as const,
    entityId: id(1),
    entityName: 'Laptop',
    version: '1',
    locations: [location],
    sites: [site],
    currentLocation: location,
  };
  const view = render(<CustodyChangeForm {...props} />);
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: site.id },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  );
  expect(
    screen.getByRole('region', { name: 'Review changes' }),
  ).toHaveTextContent('Laptop');
  fireEvent.change(
    screen.getByLabelText('Ticket number reference (optional)'),
    { target: { value: 'T-2' } },
  );
  expect(screen.queryByRole('button', { name: /^Confirm / })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Review assign/ }));
  view.rerender(
    <CustodyChangeForm {...props} sites={[{ ...site, active: false }]} />,
  );
  view.rerender(<CustodyChangeForm {...props} />);
  expect(screen.queryByRole('button', { name: /^Confirm / })).toBeNull();
  expect(submitCustody).not.toHaveBeenCalled();
});

it('requires review for asset return and fences double confirmation before dispatch renders', async () => {
  let finish!: (value: Awaited<ReturnType<typeof submitCustody>>) => void;
  vi.mocked(submitCustody).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <CustodyChangeForm
      kind="asset"
      action="return"
      entityId={id(1)}
      entityName="Laptop"
      version="1"
      locations={[location]}
      sites={[site]}
      currentSite={site}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Return to storage' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Review return to storage' }),
  );
  expect(
    screen.getByRole('region', { name: 'Review changes' }),
  ).toHaveTextContent('Laptop');
  expect(submitCustody).not.toHaveBeenCalled();
  const form = screen.getByRole('form', { name: 'Return to storage' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(submitCustody).toHaveBeenCalledOnce();
  finish({ ok: true, entityId: id(1), version: '2', changed: true });
  await screen.findByRole('button', { name: 'Done' });
});

it('assigns an asset from its authoritative storage source without duplicating a current drawer', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(1),
    version: '2',
    changed: true,
  });
  render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(1)}
      version="1"
      locations={[location]}
      sites={[site]}
      currentLocation={location}
    />,
  );
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: site.id },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  );
  expect(submitCustody).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Confirm / }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'asset_site_change',
    payload: {
      action: 'assign',
      asset_id: id(1),
      expected_version: '1',
      source_location_id: location.id,
      destination_site_id: site.id,
    },
  });
  const payload = (
    vi.mocked(submitCustody).mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }
  ).payload;
  expect(payload).not.toHaveProperty('destination_location_id');
});

it('transfers only the specified site-held quantity with stable version and no storage delta', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(1),
    version: '8',
    changed: true,
  });
  const holding = {
    site_id: site.id,
    site_code: site.code,
    site_name: site.name,
    site_active: true,
    inventory_kind: 'quantity' as const,
    entity_id: id(1),
    name: 'Adapters',
    category_name: 'Parts',
    manufacturer: null,
    model: null,
    quantity: 3,
    asset_tag: null,
    serial_number: null,
  };
  render(
    <CustodyChangeForm
      kind="quantity"
      action="transfer"
      entityId={id(1)}
      version="7"
      locations={[location]}
      sites={[site, otherSite]}
      siteHoldings={[holding]}
    />,
  );
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: otherSite.id },
  });
  fireEvent.change(screen.getByLabelText('Units'), { target: { value: '2' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review transfer between sites' }),
  );
  expect(submitCustody).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Confirm / }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  const payload = (
    vi.mocked(submitCustody).mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }
  ).payload;
  expect(payload).toMatchObject({
    action: 'transfer',
    item_id: id(1),
    expected_version: '7',
    source_site_id: site.id,
    destination_site_id: otherSite.id,
    quantity: 2,
  });
  expect(payload).not.toHaveProperty('source_location_id');
  expect(payload).not.toHaveProperty('destination_location_id');
});

it('replays the exact uncertain command despite newer custody and unavailable destinations, retaining auth uncertainty', async () => {
  vi.mocked(submitCustody)
    .mockRejectedValueOnce(new Error('lost response'))
    .mockResolvedValueOnce({
      ok: false,
      code: 'actor_changed',
      message: 'Actor changed',
    })
    .mockResolvedValueOnce({
      ok: true,
      entityId: id(1),
      version: '2',
      changed: true,
    });
  const initial = {
    kind: 'asset' as const,
    action: 'assign' as const,
    entityId: id(1),
    actorId: id(8),
    version: '1',
    locations: [location],
    sites: [site],
    currentLocation: location,
  };
  const view = render(<CustodyChangeForm {...initial} />);
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: site.id },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Confirm / }));
  await screen.findByText(/result could not be confirmed/);
  const first = vi.mocked(submitCustody).mock.calls[0][0];
  expect(first).toMatchObject({
    expectedActorId: id(8),
    payload: { expected_version: '1' },
  });
  view.rerender(
    <CustodyChangeForm
      {...initial}
      version="2"
      sites={[]}
      currentLocation={null}
      currentSite={site}
    />,
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same custody transaction' }),
  );
  await screen.findByText('Actor changed');
  expect(vi.mocked(submitCustody).mock.calls[1][0]).toEqual(first);
  expect(screen.getByLabelText('Reason (optional)')).toBeDisabled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry same custody transaction' }),
  );
  await waitFor(() => expect(submitCustody).toHaveBeenCalledTimes(3));
  expect(vi.mocked(submitCustody).mock.calls[2][0]).toEqual(first);
  expect(screen.getByRole('button', { name: 'Done' })).toBeVisible();
});

it('keeps a last-unit committed receipt independent of depleted live sources and Done performs no new write', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(1),
    version: '2',
    changed: true,
    eventId: id(10),
    custody: {
      eventId: id(10),
      operation: 'issued',
      actorName: 'Staff',
      createdAt: '2026-10-07T12:00:00Z',
      quantity: 1,
      source: {
        id: location.id,
        kind: 'storage',
        name: 'Red container',
        after: 0,
      },
      destination: { id: site.id, kind: 'site', name: site.name, after: 1 },
      reference: 'TICKET-1',
      reason: null,
    },
  });
  const props = {
    kind: 'quantity' as const,
    action: 'issue' as const,
    entityId: id(1),
    entityName: 'Adapters',
    version: '1',
    locations: [location],
    sites: [site],
    storageBalances: [{ location, quantity: 1 }],
  };
  const view = render(<CustodyChangeForm {...props} />);
  fireEvent.change(screen.getByLabelText('Destination site'), {
    target: { value: site.id },
  });
  fireEvent.click(
    screen.getByRole('button', { name: 'Review issue stock to a site' }),
  );
  fireEvent.click(screen.getByRole('button', { name: /^Confirm / }));
  await screen.findByRole('button', { name: 'Done' });
  view.rerender(
    <CustodyChangeForm
      {...props}
      version="3"
      locations={[]}
      sites={[]}
      storageBalances={[]}
    />,
  );
  expect(
    screen.getByRole('region', { name: 'Committed custody receipt' }),
  ).toHaveTextContent('Red container');
  expect(
    screen.getByText('Red container · remaining after this operation')
      .nextElementSibling,
  ).toHaveTextContent('0 units');
  expect(
    screen.queryByRole('combobox', { name: 'Destination site' }),
  ).toBeNull();
  expect(screen.queryByText(/No sites are configured/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(submitCustody).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Issue another' })).toBeDisabled();
});

it('preserves a last-unit return source name even when it leaves site holdings and choices', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(1),
    version: '2',
    changed: true,
    custody: {
      eventId: id(10),
      operation: 'returned',
      actorName: 'Staff',
      createdAt: '2026-10-07T12:00:00Z',
      quantity: 1,
      source: { id: site.id, kind: 'site', name: site.name, after: 0 },
      destination: {
        id: location.id,
        kind: 'storage',
        name: location.name,
        after: 5,
      },
      reference: null,
      reason: null,
    },
  });
  const props = {
    kind: 'quantity' as const,
    action: 'return' as const,
    entityId: id(1),
    version: '1',
    locations: [location],
    sites: [site],
    currentSite: site,
    siteHoldings: [
      {
        site_id: site.id,
        site_code: site.code,
        site_name: site.name,
        site_active: true,
        inventory_kind: 'quantity' as const,
        entity_id: id(1),
        name: 'Adapters',
        category_name: 'Parts',
        manufacturer: null,
        model: null,
        quantity: 1,
        asset_tag: null,
        serial_number: null,
      },
    ],
  };
  const view = render(<CustodyChangeForm {...props} />);
  fireEvent.click(
    screen
      .getAllByRole('button', { name: 'Return to storage' })
      .find((button) => button.getAttribute('type') === 'button')!,
  );
  fireEvent.submit(screen.getByRole('form', { name: 'Return to storage' }));
  fireEvent.click(screen.getByRole('button', { name: /^Confirm / }));
  await screen.findByRole('button', { name: 'Done' });
  view.rerender(
    <CustodyChangeForm {...props} version="2" sites={[]} siteHoldings={[]} />,
  );
  expect(
    screen.getByRole('region', { name: 'Committed custody receipt' }),
  ).toHaveTextContent(site.name);
  expect(
    screen.getByText(`${site.name} · remaining after this operation`)
      .nextElementSibling,
  ).toHaveTextContent('0 units');
});
it.each([true, false])(
  'renders a correction acknowledgement without transfer language when receipt is unavailable (changed=%s)',
  async (changed) => {
    vi.mocked(submitCustody).mockResolvedValue({
      ok: true,
      entityId: id(1),
      version: changed ? '2' : '1',
      changed,
      ...(changed ? { eventId: id(10), refreshFailed: true } : {}),
    });
    render(
      <CustodyChangeForm
        kind="quantity"
        action="correct"
        entityId={id(1)}
        version="1"
        locations={[location]}
        sites={[site]}
        currentSite={site}
        siteHoldings={[
          {
            site_id: site.id,
            site_code: site.code,
            site_name: site.name,
            site_active: true,
            inventory_kind: 'quantity',
            entity_id: id(1),
            name: 'Adapters',
            category_name: 'Parts',
            manufacturer: null,
            model: null,
            quantity: 5,
            asset_tag: null,
            serial_number: null,
          },
        ]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Observed units at site'), {
      target: { value: changed ? '10' : '5' },
    });
    fireEvent.change(screen.getByLabelText('Reason (required)'), {
      target: { value: 'Count verified' },
    });
    fireEvent.submit(
      screen.getByRole('form', { name: 'Correct recorded site holding' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Confirm / }));
    await screen.findByRole('button', { name: 'Done' });
    const completion = screen.getByRole('region', {
      name: 'Custody completion',
    });
    expect(completion).toHaveTextContent(`Count correction at ${site.name}`);
    expect(completion).toHaveTextContent(
      `Reviewed observed count: ${changed ? 10 : 5} units (submitted for this operation)`,
    );
    expect(completion).toHaveTextContent(
      changed
        ? 'The transaction is confirmed. The event receipt is not available yet'
        : 'No balance change was needed.',
    );
    expect(completion).not.toHaveTextContent('→');
    expect(completion).not.toHaveTextContent('No destination');
    expect(completion).not.toHaveTextContent('Signed adjustment');
    expect(submitCustody).toHaveBeenCalledOnce();
  },
);
