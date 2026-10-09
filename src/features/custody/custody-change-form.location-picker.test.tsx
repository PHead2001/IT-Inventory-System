import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { CustodyChangeForm } from './custody-change-form';
import { submitCustody } from './actions';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('./actions', () => ({ submitCustody: vi.fn() }));

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const rack = {
  id: id(1),
  code: 'ITC-RACK',
  name: 'Server Rack',
  breadcrumb: 'IT Closet / Server Rack',
  parentId: null,
  active: true,
  can_hold_inventory: true,
};
const drawer = {
  ...rack,
  id: id(2),
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'IT Closet / Drawer 1',
};
const site = {
  id: id(3),
  code: 'PROPERTY-A',
  name: 'Fictional Property',
  notes: null,
  active: true,
  version: '1',
};

beforeEach(() => {
  vi.mocked(submitCustody).mockReset();
  refresh.mockReset();
});

it('suggests a verified Return origin once, preserves a manual choice and explicit clear through refresh', async () => {
  const user = userEvent.setup();
  const props = {
    kind: 'asset' as const,
    action: 'return' as const,
    entityId: id(4),
    version: '80',
    locations: [rack, drawer],
    sites: [site],
    currentSite: site,
    returnSuggestion: {
      assetId: id(4),
      assetVersion: '80',
      sourceEventId: id(6),
      locationId: rack.id,
      status: 'suggested' as const,
    },
  };
  const view = render(<CustodyChangeForm {...props} />);
  const picker = screen.getByLabelText('Return to storage', {
    exact: true,
    selector: 'button',
  });
  expect(picker).toHaveTextContent('Server Rack');
  await user.click(picker);
  await user.type(
    screen.getByRole('combobox', { name: 'Search locations' }),
    'ITC-D01',
  );
  await user.click(screen.getByRole('option', { name: /Drawer 1/ }));
  view.rerender(
    <CustodyChangeForm
      {...props}
      returnSuggestion={{
        ...props.returnSuggestion,
        locationId: rack.id,
        sourceEventId: id(7),
      }}
    />,
  );
  expect(picker).toHaveTextContent('Drawer 1');
  await user.click(screen.getByRole('button', { name: 'Clear destination' }));
  view.rerender(<CustodyChangeForm {...props} />);
  expect(picker).toHaveTextContent('Select a location');
  expect(submitCustody).not.toHaveBeenCalled();
});

it.each(['no_storage_origin', 'ineligible', 'unavailable'] as const)(
  'does not prefill a %s Return',
  (status) => {
    render(
      <CustodyChangeForm
        kind="asset"
        action="return"
        entityId={id(4)}
        version="80"
        locations={[rack, drawer]}
        sites={[site]}
        currentSite={site}
        returnSuggestion={{
          assetId: id(4),
          assetVersion: '80',
          sourceEventId: null,
          locationId: null,
          status,
        }}
      />,
    );
    expect(
      screen.getByLabelText('Return to storage', {
        exact: true,
        selector: 'button',
      }),
    ).toHaveTextContent('Select a location');
  },
);

it.each([
  {
    version: '79',
    assetId: id(4),
    location: rack,
    expected: /origin.*unavailable/,
  },
  {
    version: '80',
    assetId: id(9),
    location: rack,
    expected: /origin.*unavailable/,
  },
  {
    version: '80',
    assetId: id(4),
    location: { ...rack, active: false },
    expected: /no longer available/,
  },
  {
    version: '80',
    assetId: id(4),
    location: { ...rack, can_hold_inventory: false },
    expected: /no longer available/,
  },
])(
  'validates suggestion identity and current eligibility for both value and explanation: %j',
  ({ version, assetId, location, expected }) => {
    render(
      <CustodyChangeForm
        kind="asset"
        action="return"
        entityId={id(4)}
        version="80"
        locations={[location, drawer]}
        sites={[site]}
        currentSite={site}
        returnSuggestion={{
          assetId,
          assetVersion: version,
          sourceEventId: id(6),
          locationId: rack.id,
          status: 'suggested',
        }}
      />,
    );
    expect(
      screen.getByRole('combobox', { name: 'Return to storage' }),
    ).toHaveTextContent('Select a location');
    expect(screen.getByText(expected)).toBeVisible();
    expect(screen.queryByText(/Initially suggested/)).toBeNull();
  },
);

it('invalidates a stale Return review and preserves explicit clearing when reviewing the latest holdings', async () => {
  const user = userEvent.setup();
  const props = {
    kind: 'asset' as const,
    action: 'return' as const,
    entityId: id(4),
    version: '80',
    locations: [rack, drawer],
    sites: [site],
    currentSite: site,
    returnSuggestion: {
      assetId: id(4),
      assetVersion: '80',
      sourceEventId: id(6),
      locationId: rack.id,
      status: 'suggested' as const,
    },
  };
  const view = render(<CustodyChangeForm {...props} />);
  await user.click(
    screen.getByRole('button', { name: 'Review return to storage' }),
  );
  expect(
    screen.getByRole('button', { name: 'Confirm return to storage' }),
  ).toBeEnabled();
  view.rerender(
    <CustodyChangeForm
      {...props}
      version="81"
      returnSuggestion={{ ...props.returnSuggestion, assetVersion: '81' }}
    />,
  );
  expect(
    screen.queryByRole('button', { name: 'Confirm return to storage' }),
  ).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Review latest holdings' }),
  );
  await user.click(screen.getByRole('button', { name: 'Clear destination' }));
  view.rerender(
    <CustodyChangeForm
      {...props}
      version="82"
      returnSuggestion={{ ...props.returnSuggestion, assetVersion: '82' }}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'Review latest holdings' }),
  );
  expect(
    screen.getByRole('combobox', { name: 'Return to storage' }),
  ).toHaveTextContent('Select a location');
  expect(submitCustody).not.toHaveBeenCalled();
});

it.each(['manual', 'cleared'] as const)(
  'keeps a rejected Return blocked through failed refresh and preserves the %s destination until explicit latest review',
  async (destination) => {
    const user = userEvent.setup();
    refresh.mockImplementationOnce(() => {
      throw new Error('Refresh unavailable');
    });
    vi.mocked(submitCustody).mockResolvedValueOnce({
      ok: false,
      code: 'P1002',
      message: 'This record changed.',
    });
    const props = {
      actorId: id(9),
      kind: 'asset' as const,
      action: 'return' as const,
      entityId: id(4),
      version: '80',
      locations: [rack, drawer],
      sites: [site],
      currentSite: site,
      returnSuggestion: {
        assetId: id(4),
        assetVersion: '80',
        sourceEventId: id(6),
        locationId: rack.id,
        status: 'suggested' as const,
      },
    };
    const view = render(<CustodyChangeForm {...props} />);
    const picker = screen.getByRole('combobox', { name: 'Return to storage' });
    await user.click(picker);
    await user.type(
      screen.getByRole('combobox', { name: 'Search locations' }),
      'ITC-D01',
    );
    await user.click(screen.getByRole('option', { name: /Drawer 1/ }));
    await user.type(
      screen.getByLabelText('Ticket number reference (optional)'),
      'Keep draft',
    );
    await user.click(
      screen.getByRole('button', { name: 'Review return to storage' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Confirm return to storage' }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole('button', { name: 'Review return to storage' }),
    ).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Review latest holdings' }),
    ).toBeNull();
    expect(screen.getByText(/latest holdings have not loaded/i)).toBeVisible();
    expect(picker).toHaveTextContent('Drawer 1');
    const rejected = vi.mocked(submitCustody).mock.calls[0][0] as {
      requestId: string;
    };
    expect(
      screen.getByRole('button', { name: 'Clear destination' }),
    ).toBeDisabled();
    expect(
      screen.getByLabelText('Ticket number reference (optional)'),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Review return to storage' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('button', { name: 'Refresh latest holdings' }),
    );
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(submitCustody).toHaveBeenCalledTimes(1);
    // An unchanged snapshot cannot authorize another attempt.
    view.rerender(<CustodyChangeForm {...props} />);
    expect(
      screen.getByRole('button', { name: 'Review return to storage' }),
    ).toBeDisabled();
    const latest = {
      ...props,
      version: '81',
      returnSuggestion: { ...props.returnSuggestion, assetVersion: '81' },
    };
    view.rerender(<CustodyChangeForm {...latest} />);
    expect(
      screen.getByRole('button', { name: 'Review return to storage' }),
    ).toBeDisabled();
    expect(picker).toHaveTextContent('Drawer 1');
    await user.click(
      screen.getByRole('button', { name: 'Review latest holdings' }),
    );
    expect(picker).toHaveTextContent('Drawer 1');
    expect(
      screen.getByLabelText('Ticket number reference (optional)'),
    ).toHaveValue('Keep draft');
    expect(
      screen.queryByRole('button', { name: 'Confirm return to storage' }),
    ).toBeNull();
    if (destination === 'cleared') {
      await user.click(
        screen.getByRole('button', { name: 'Clear destination' }),
      );
      view.rerender(<CustodyChangeForm {...latest} version="82" />);
      expect(picker).toHaveTextContent('Select a location');
      await user.click(
        screen.getByRole('button', { name: 'Review latest holdings' }),
      );
      expect(picker).toHaveTextContent('Select a location');
      await user.click(picker);
      await user.type(
        screen.getByRole('combobox', { name: 'Search locations' }),
        'ITC-D01',
      );
      await user.click(screen.getByRole('option', { name: /Drawer 1/ }));
    }
    vi.mocked(submitCustody).mockResolvedValueOnce({
      ok: true,
      entityId: id(4),
      version: '83',
      changed: true,
    });
    await user.click(
      screen.getByRole('button', { name: 'Review return to storage' }),
    );
    expect(submitCustody).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole('button', { name: 'Confirm return to storage' }),
    );
    await waitFor(() => expect(submitCustody).toHaveBeenCalledTimes(2));
    const renewed = vi.mocked(submitCustody).mock.calls[1][0] as {
      requestId: string;
      payload: Record<string, unknown>;
    };
    expect(renewed.requestId).not.toBe(rejected.requestId);
    expect(renewed.payload).toMatchObject({
      expected_version: destination === 'cleared' ? '82' : '81',
      destination_location_id: drawer.id,
      reference: 'Keep draft',
    });
  },
);

it('shows every Issue source balance before selection and updates amounts without selecting again', async () => {
  const user = userEvent.setup();
  const props = {
    kind: 'quantity' as const,
    action: 'issue' as const,
    entityId: id(4),
    version: '7',
    locations: [rack, drawer],
    sites: [site],
    storageBalances: [
      { location: rack, quantity: 8 },
      { location: drawer, quantity: 13 },
    ],
  };
  const view = render(<CustodyChangeForm {...props} />);
  await user.click(screen.getByLabelText('Storage source', { exact: true }));
  await user.type(
    screen.getByRole('combobox', { name: 'Search locations' }),
    'ITC',
  );
  expect(
    screen.getByRole('option', { name: /Server Rack.*8 units available/ }),
  ).toBeVisible();
  expect(
    screen.getByRole('option', { name: /Drawer 1.*13 units available/ }),
  ).toBeVisible();
  view.rerender(
    <CustodyChangeForm
      {...props}
      storageBalances={[
        { location: rack, quantity: 5 },
        { location: drawer, quantity: 16 },
      ]}
    />,
  );
  expect(
    screen.getByRole('option', { name: /Server Rack.*5 units available/ }),
  ).toBeVisible();
  expect(
    screen.getByRole('option', { name: /Drawer 1.*16 units available/ }),
  ).toBeVisible();
});

it('real source picker accepts the asset current storage location without quantity balances and excludes other locations', async () => {
  const user = userEvent.setup();
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(4),
    version: '8',
    changed: true,
  });
  render(
    <CustodyChangeForm
      kind="asset"
      action="assign"
      entityId={id(4)}
      version="7"
      locations={[rack, drawer]}
      sites={[site]}
      currentLocation={rack}
    />,
  );
  const source = screen.getByLabelText('Storage source', { exact: true });
  expect(source).toHaveTextContent('Server Rack');
  expect(source).toHaveAttribute('aria-invalid', 'false');
  expect(screen.queryByText('Unavailable')).not.toBeInTheDocument();
  await user.click(source);
  const search = screen.getByRole('combobox', { name: 'Search locations' });
  await user.type(search, 'ITC-D01');
  expect(
    screen.queryByRole('option', { name: /Drawer 1/ }),
  ).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, 'ITC-RACK');
  expect(
    await screen.findByRole('option', { name: /Server Rack/ }),
  ).toBeVisible();
  await user.keyboard('{Escape}');
  await user.selectOptions(screen.getByLabelText('Destination site'), site.id);
  await user.click(
    screen.getByRole('button', { name: 'Review assign asset to a site' }),
  );
  expect(submitCustody).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Confirm assign asset to a site' }),
  );
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    payload: {
      asset_id: id(4),
      expected_version: '7',
      source_location_id: rack.id,
      destination_site_id: site.id,
    },
  });
});
