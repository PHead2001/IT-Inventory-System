import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocationManagementForm, SiteManagementForm } from './management-form';
import { submitCustody } from './actions';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('./actions', () => ({ submitCustody: vi.fn() }));
const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const room = {
  id: id(1),
  code: 'ITO',
  name: 'IT Office',
  parent_id: null,
  kind: 'room',
  can_hold_inventory: false,
  active: true,
  sort_order: 0,
  version: '1',
};
const area = {
  id: id(2),
  code: 'ITO-GENERAL',
  name: 'General Storage / Unsorted',
  parent_id: room.id,
  kind: 'storage_area',
  can_hold_inventory: true,
  active: true,
  sort_order: 1,
  version: '1',
};
beforeEach(() => {
  vi.mocked(submitCustody).mockReset();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://site-test.supabase.co');
  sessionStorage.clear();
  window.history.replaceState(null, '', '/settings/sites');
});

it('keeps site creation errors associated and focuses Name before submission', () => {
  render(<SiteManagementForm />);
  const name = screen.getByLabelText('Name');
  fireEvent.submit(name.closest('form')!);
  expect(submitCustody).not.toHaveBeenCalled();
  expect(name).toHaveFocus();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(name).toHaveAccessibleDescription(/Enter/);
});

it('retains code guidance and optional Notes while correcting invalid site format', async () => {
  const user = userEvent.setup();
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(9),
    version: '1',
    changed: true,
  });
  render(<SiteManagementForm />);
  await user.type(screen.getByLabelText('Name'), 'Fictional property');
  const code = screen.getByLabelText('Permanent code', { exact: true });
  await user.click(code);
  await user.keyboard('{Control>}a{/Control}');
  await user.type(code, 'BAD CODE', { skipClick: true });
  await user.click(screen.getByRole('button', { name: 'Save site' }));
  expect(submitCustody).not.toHaveBeenCalled();
  expect(code).toHaveFocus();
  expect(code).toHaveAttribute('aria-invalid', 'true');
  expect(code).toHaveAccessibleDescription(
    /Suggested from the name.*Use the required format/,
  );
  expect(screen.getByLabelText('Name')).toHaveValue('Fictional property');
  expect(screen.getByLabelText('Notes')).not.toBeRequired();
  await user.click(code);
  await user.keyboard('{Control>}a{/Control}');
  await user.type(code, 'VALID-CODE', { skipClick: true });
  await user.click(screen.getByRole('button', { name: 'Save site' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalledOnce());
  expect(code).not.toHaveAttribute('aria-invalid');
});

it('suggests a site code from its name and submits that visible suggestion', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: false,
    code: 'P1007',
    message: 'That permanent code is already in use.',
  });
  render(<SiteManagementForm />);
  const name = screen.getByLabelText('Name');
  const code = screen.getByLabelText('Permanent code', { exact: true });
  expect(
    name.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  fireEvent.change(name, { target: { value: 'Oak Creek Apartments' } });
  expect(code).toHaveValue('OAK-CREEK-APARTMENTS');
  fireEvent.submit(
    screen.getByRole('heading', { name: 'Add property/site' }).closest('form')!,
  );

  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'site_create',
    payload: { code: 'OAK-CREEK-APARTMENTS', name: 'Oak Creek Apartments' },
  });
  expect(screen.getByRole('status')).toHaveTextContent(
    'That permanent code is already in use.',
  );
});

it('finishes site creation with a named receipt and only Add another opens an empty new operation', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: id(9),
    version: '1',
    changed: true,
  });
  render(<SiteManagementForm />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Oak Creek' },
  });
  const form = screen
    .getByRole('button', { name: 'Save site' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await screen.findByRole('heading', { name: 'Site created' });
  expect(submitCustody).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: 'Save site' })).toBeNull();
  expect(screen.getByRole('link', { name: 'View site' })).toHaveAttribute(
    'href',
    '/sites/OAK-CREEK',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Add another' }));
  expect(screen.getByLabelText('Name')).toHaveValue('');
  expect(screen.getByLabelText('Permanent code', { exact: true })).toHaveValue(
    '',
  );
  expect(submitCustody).toHaveBeenCalledTimes(1);
});

it('recovers dirty site values with their original version through navigation and blocks stale save', () => {
  const view = render(<SiteManagementForm site={site} actorId={id(8)} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Recovered name' },
  });
  view.unmount();
  render(
    <SiteManagementForm
      site={{ ...site, name: 'External change', version: '2' }}
      actorId={id(8)}
    />,
  );
  expect(screen.getByLabelText('Name')).toHaveValue('Recovered name');
  expect(screen.getByRole('button', { name: 'Save site' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Site settings changed elsewhere',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Name')).toHaveValue('External change');
});

it('recovers an unknown site-create request exactly, retains its canonical draft and completes once', async () => {
  vi.mocked(submitCustody)
    .mockRejectedValueOnce(new Error('response lost'))
    .mockResolvedValueOnce({
      ok: true,
      entityId: id(9),
      version: '1',
      changed: true,
    });
  const view = render(<SiteManagementForm actorId={id(8)} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Retry site' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
  await screen.findByRole('button', { name: 'Retry submission' });
  const original = vi.mocked(submitCustody).mock.calls[0][0];
  const draft = new URL(window.location.href).searchParams.get('siteDraft');
  view.unmount();
  render(<SiteManagementForm actorId={id(8)} />);
  expect(screen.getByLabelText('Name')).toHaveValue('Retry site');
  expect(screen.getByLabelText('Name')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
  await screen.findByRole('heading', { name: 'Site created' });
  expect(vi.mocked(submitCustody).mock.calls[1][0]).toEqual(original);
  expect(new URL(window.location.href).searchParams.get('siteDraft')).toBe(
    draft,
  );
});

it('does not restore another actor or backend site draft', () => {
  const view = render(<SiteManagementForm site={site} actorId={id(8)} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Private draft' },
  });
  view.unmount();
  const other = render(<SiteManagementForm site={site} actorId={id(9)} />);
  expect(screen.getByLabelText('Name')).toHaveValue(site.name);
  other.unmount();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://other-test.supabase.co');
  render(<SiteManagementForm site={site} actorId={id(8)} />);
  expect(screen.getByLabelText('Name')).toHaveValue(site.name);
});

it('masks same-mounted drafts and completion across actor/environment changes and restores the original context', () => {
  const view = render(<SiteManagementForm site={site} actorId={id(8)} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Actor A draft' },
  });
  view.rerender(<SiteManagementForm site={site} actorId={id(9)} />);
  expect(screen.queryByLabelText('Name')).toBeNull();
  expect(screen.queryByDisplayValue('Actor A draft')).toBeNull();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'another signed-in account or environment',
  );
  view.rerender(<SiteManagementForm site={site} actorId={id(8)} />);
  expect(screen.getByLabelText('Name')).toHaveValue('Actor A draft');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://changed.supabase.co');
  view.rerender(<SiteManagementForm site={site} actorId={id(8)} />);
  expect(screen.queryByLabelText('Name')).toBeNull();
});

it('keeps known site creation success while retrying only the exact durable terminal acknowledgement', async () => {
  const original = Storage.prototype.setItem;
  let failTerminal = false;
  const storage = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key: string, value: string) {
      if (
        failTerminal &&
        key.startsWith('inventory-site-task-v1:') &&
        JSON.parse(value).status === 'saved'
      )
        throw new Error('Storage unavailable');
      original.call(this, key, value);
    });
  try {
    vi.mocked(submitCustody).mockImplementation(async () => {
      failTerminal = true;
      return { ok: true, entityId: id(9), version: '1', changed: true };
    });
    render(<SiteManagementForm actorId={id(8)} />);
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Confirmed site' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
    await screen.findByRole('heading', { name: 'Site created' });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Site saved, but completion recovery',
    );
    expect(screen.getByRole('button', { name: 'Add another' })).toBeDisabled();
    failTerminal = false;
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry site recovery' }),
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add another' })).toBeEnabled();
    expect(submitCustody).toHaveBeenCalledTimes(1);
    const saved = Array.from({ length: sessionStorage.length }, (_, index) =>
      sessionStorage.getItem(sessionStorage.key(index)!),
    ).find((raw) => raw?.includes('Confirmed site'))!;
    expect(JSON.parse(saved).status).toBe('saved');
  } finally {
    storage.mockRestore();
  }
});

it('masks a pending site response after actor change and resolves only under the original actor', async () => {
  let finish!: (result: Awaited<ReturnType<typeof submitCustody>>) => void;
  vi.mocked(submitCustody)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    )
    .mockResolvedValueOnce({
      ok: true,
      entityId: id(9),
      version: '1',
      changed: true,
    });
  const view = render(<SiteManagementForm actorId={id(8)} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Actor A pending' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
  const command = vi.mocked(submitCustody).mock.calls[0][0];
  view.rerender(<SiteManagementForm actorId={id(9)} />);
  finish({ ok: true, entityId: id(9), version: '1', changed: true });
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Site created' })).toBeNull(),
  );
  view.rerender(<SiteManagementForm actorId={id(8)} />);
  await screen.findByRole('button', { name: 'Retry submission' });
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
  await screen.findByRole('heading', { name: 'Site created' });
  expect(vi.mocked(submitCustody).mock.calls[1][0]).toEqual(command);
});

it('keeps a nonempty manual code through name edits and restores the suggestion when cleared', () => {
  render(<SiteManagementForm />);
  const name = screen.getByLabelText('Name');
  const code = screen.getByLabelText('Permanent code', { exact: true });
  fireEvent.change(name, { target: { value: 'Oak Creek Apartments' } });
  fireEvent.change(code, { target: { value: 'CUSTOM-42' } });
  fireEvent.change(name, { target: { value: 'Renamed Property' } });
  expect(code).toHaveValue('CUSTOM-42');

  fireEvent.change(code, { target: { value: '' } });
  expect(code).toHaveValue('RENAMED-PROPERTY');
});

it('leaves an invalid name without a suggestion so a valid code must be entered manually', () => {
  render(<SiteManagementForm />);
  const code = screen.getByLabelText('Permanent code', { exact: true });
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: '123 Oak Creek' },
  });
  expect(code).toHaveValue('');
  expect(code).toBeRequired();
  fireEvent.change(code, { target: { value: 'SITE-123' } });
  expect(code).toHaveValue('SITE-123');
});

const site = {
  id: id(3),
  code: 'HQ',
  name: 'Headquarters',
  notes: 'Original notes',
  active: true,
  version: '1',
};

it('exposes only name editing and submits immutable location identity with the captured version', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: area.id,
    version: '2',
    changed: true,
  });
  render(<LocationManagementForm location={area} actorId={id(8)} />);
  for (const label of [
    'Parent location',
    'Kind',
    'Can hold inventory',
    'Active location',
    'Sort order',
    'Permanent code',
  ])
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Office supplies' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'location_rename',
    expectedActorId: id(8),
    payload: {
      location_id: area.id,
      expected_version: '1',
      name: 'Office supplies',
    },
  });
});

it('retains dirty entries after refresh without adopting a fresh version and discards explicitly on Cancel', () => {
  const view = render(<LocationManagementForm location={area} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'My label' },
  });
  view.rerender(
    <LocationManagementForm
      location={{ ...area, version: '2', name: 'Their label' }}
    />,
  );
  expect(screen.getByLabelText('Name')).toHaveValue('My label');
  expect(screen.getByRole('button', { name: 'Save name' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Name')).toHaveValue('Their label');
  expect(screen.getByRole('button', { name: 'Save name' })).toBeEnabled();
});

it('refreshes an untouched site baseline and values together', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: false,
    code: 'P1012',
    message: 'Invalid',
  });
  const view = render(<SiteManagementForm site={site} />);
  view.rerender(
    <SiteManagementForm
      site={{ ...site, name: 'Latest', notes: 'Latest notes', version: '2' }}
    />,
  );
  expect(screen.getByLabelText('Name')).toHaveValue('Latest');
  expect(screen.getByLabelText('Notes')).toHaveValue('Latest notes');
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    payload: { expected_version: '2', name: 'Latest', notes: 'Latest notes' },
  });
});

it('establishes the saved baseline immediately and allows another edit before or after its own refresh', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: site.id,
    version: '2',
    changed: true,
  });
  const view = render(<SiteManagementForm site={site} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Saved label' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
  await screen.findByText('Site saved. Code and history remain unchanged.');
  view.rerender(
    <SiteManagementForm
      site={{ ...site, name: 'Saved label', version: '2' }}
    />,
  );
  fireEvent.change(screen.getByLabelText('Notes'), {
    target: { value: 'Second edit' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalledTimes(2));
  expect(vi.mocked(submitCustody).mock.calls[1][0]).toMatchObject({
    payload: {
      expected_version: '2',
      name: 'Saved label',
      notes: 'Second edit',
    },
  });
});

it('offers explicit archive confirmation, current holding links, and a reason without sending metadata', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: false,
    code: 'P1008',
    message: 'Resolve current holdings.',
  });
  render(
    <SiteManagementForm
      site={site}
      holdings={[
        {
          site_id: site.id,
          site_code: site.code,
          site_name: site.name,
          site_active: true,
          inventory_kind: 'quantity',
          entity_id: id(4),
          name: 'Assigned cables',
          category_name: 'Cables',
          manufacturer: null,
          model: null,
          quantity: 3,
          asset_tag: null,
          serial_number: null,
        },
      ]}
      holdingTotal={1}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Archive site' }));
  expect(screen.getByText(/Archive Headquarters/)).toHaveTextContent(
    'History and its permanent code are retained',
  );
  expect(
    screen.getByRole('link', { name: /Assigned cables.*3 units/ }),
  ).toHaveAttribute('href', `/inventory/quantity/${id(4)}`);
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Property closed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive site' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalled());
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'site_set_active',
    payload: {
      site_id: site.id,
      expected_version: '1',
      active: false,
      reason: 'Property closed',
    },
  });
  expect(
    Object.keys(
      (vi.mocked(submitCustody).mock.calls[0][0] as { payload: object })
        .payload,
    ).sort(),
  ).toEqual(['active', 'expected_version', 'reason', 'site_id']);
});

it('restores the same site through a reasoned lifecycle action', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: true,
    entityId: site.id,
    version: '2',
    changed: true,
  });
  render(<SiteManagementForm site={{ ...site, active: false }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore site' }));
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Reopened' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore site' }));
  await screen.findByText('Site saved. Code and history remain unchanged.');
  expect(screen.getByRole('button', { name: 'Archive site' })).toBeEnabled();
  expect(vi.mocked(submitCustody).mock.calls[0][0]).toMatchObject({
    operation: 'site_set_active',
    payload: {
      site_id: site.id,
      expected_version: '1',
      active: true,
      reason: 'Reopened',
    },
  });
});

it('retains exact uncertain retry after a refresh and rejects synchronous duplicate submissions', async () => {
  let resolve!: (result: Awaited<ReturnType<typeof submitCustody>>) => void;
  vi.mocked(submitCustody)
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce({
      ok: true,
      entityId: area.id,
      version: '2',
      changed: true,
    });
  const view = render(
    <LocationManagementForm location={area} actorId={id(8)} />,
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'My label' },
  });
  const form = screen
    .getByRole('button', { name: 'Save name' })
    .closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(submitCustody).toHaveBeenCalledTimes(1);
  resolve({ ok: false, code: 'unexpected', message: 'Unconfirmed' });
  await screen.findByRole('button', { name: 'Retry submission' });
  view.rerender(
    <LocationManagementForm
      location={{ ...area, name: 'My label', version: '2' }}
      actorId={id(8)}
    />,
  );
  expect(screen.getByLabelText('Name')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalledTimes(2));
  expect(vi.mocked(submitCustody).mock.calls[1][0]).toEqual(
    vi.mocked(submitCustody).mock.calls[0][0],
  );
});

it('retains site settings drafts through changed props and blocks a stale metadata save', () => {
  const view = render(<SiteManagementForm site={site} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'My property label' },
  });
  view.rerender(
    <SiteManagementForm
      site={{ ...site, notes: 'Independent latest notes', version: '2' }}
    />,
  );
  expect(screen.getByLabelText('Name')).toHaveValue('My property label');
  expect(screen.getByRole('button', { name: 'Save site' })).toBeDisabled();
  fireEvent.submit(
    screen.getByRole('button', { name: 'Save site' }).closest('form')!,
  );
  expect(submitCustody).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByLabelText('Notes')).toHaveValue(
    'Independent latest notes',
  );
});

it('keeps an archive confirmation bound to its reviewed version after a refresh', () => {
  const view = render(<SiteManagementForm site={site} />);
  fireEvent.click(screen.getByRole('button', { name: 'Archive site' }));
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Closure' },
  });
  view.rerender(
    <SiteManagementForm
      site={{ ...site, name: 'Renamed elsewhere', version: '2' }}
    />,
  );
  expect(
    screen.getByRole('button', { name: 'Confirm archive site' }),
  ).toBeDisabled();
  expect(screen.getByLabelText('Reason')).toHaveValue('Closure');
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Confirm archive site' })
      .closest('form')!,
  );
  expect(submitCustody).not.toHaveBeenCalled();
});

for (const code of ['P1001', 'actor_changed', 'P1009']) {
  it(`keeps the unresolved rename receipt after ${code} until the original submission confirms`, async () => {
    vi.mocked(submitCustody)
      .mockResolvedValueOnce({
        ok: false,
        code: 'unexpected',
        message: 'Unconfirmed',
      })
      .mockResolvedValueOnce({
        ok: false,
        code,
        message: 'Cannot confirm original outcome',
      })
      .mockResolvedValueOnce({
        ok: true,
        entityId: area.id,
        version: '2',
        changed: true,
      });
    const view = render(
      <LocationManagementForm location={area} actorId={id(8)} />,
    );
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'My saved label' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByRole('button', { name: 'Retry submission' });
    const original = vi.mocked(submitCustody).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
    await screen.findByText('Cannot confirm original outcome');
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Retry submission' }),
    ).toBeEnabled();
    view.rerender(
      <LocationManagementForm
        location={{ ...area, version: '2', name: 'My saved label' }}
        actorId={id(8)}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
    await screen.findByText(
      'Location renamed. Structure, inventory and history remain intact.',
    );
    expect(vi.mocked(submitCustody).mock.calls.map((call) => call[0])).toEqual([
      original,
      original,
      original,
    ]);
    expect(screen.getByLabelText('Name')).toBeEnabled();
  });
}

it('keeps a reasoned archive command across revoked membership and replays it after access returns', async () => {
  vi.mocked(submitCustody)
    .mockResolvedValueOnce({
      ok: false,
      code: 'unexpected',
      message: 'Unconfirmed',
    })
    .mockResolvedValueOnce({
      ok: false,
      code: 'P1001',
      message: 'Membership revoked',
    })
    .mockResolvedValueOnce({
      ok: true,
      entityId: site.id,
      version: '2',
      changed: true,
    });
  const view = render(<SiteManagementForm site={site} actorId={id(8)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Archive site' }));
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Property closed' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm archive site' }));
  await screen.findByRole('button', { name: 'Retry submission' });
  const original = vi.mocked(submitCustody).mock.calls[0][0];
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
  await screen.findByText('Membership revoked');
  expect(screen.getByLabelText('Reason')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  view.rerender(
    <SiteManagementForm
      site={{ ...site, active: false, version: '2' }}
      actorId={id(8)}
    />,
  );
  expect(screen.getByLabelText('Reason')).toHaveValue('Property closed');
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
  await screen.findByRole('button', { name: 'Restore site' });
  expect(vi.mocked(submitCustody).mock.calls.map((call) => call[0])).toEqual([
    original,
    original,
    original,
  ]);
});

it('blocks an unresolved command in another actor context and retains it when the original actor returns', async () => {
  vi.mocked(submitCustody)
    .mockResolvedValueOnce({
      ok: false,
      code: 'unexpected',
      message: 'Unconfirmed',
    })
    .mockResolvedValueOnce({
      ok: true,
      entityId: area.id,
      version: '2',
      changed: true,
    });
  const view = render(
    <LocationManagementForm location={area} actorId={id(8)} />,
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Original actor label' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await screen.findByRole('button', { name: 'Retry submission' });
  const original = vi.mocked(submitCustody).mock.calls[0][0];
  view.rerender(<LocationManagementForm location={area} actorId={id(9)} />);
  expect(
    screen.getByRole('button', { name: 'Retry submission' }),
  ).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'original signed-in account',
  );
  fireEvent.submit(
    screen.getByRole('button', { name: 'Retry submission' }).closest('form')!,
  );
  expect(submitCustody).toHaveBeenCalledTimes(1);
  view.rerender(<LocationManagementForm location={area} actorId={id(8)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry submission' }));
  await screen.findByText(
    'Location renamed. Structure, inventory and history remain intact.',
  );
  expect(vi.mocked(submitCustody).mock.calls[1][0]).toEqual(original);
});

it('allows revised intent after a first known permission denial without an uncertain operation', async () => {
  vi.mocked(submitCustody).mockResolvedValue({
    ok: false,
    code: 'P1001',
    message: 'Permission denied',
  });
  render(<LocationManagementForm location={area} actorId={id(8)} />);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'First label' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await screen.findByText('Permission denied');
  expect(screen.getByLabelText('Name')).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Revised label' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
  await waitFor(() => expect(submitCustody).toHaveBeenCalledTimes(2));
  expect(
    (vi.mocked(submitCustody).mock.calls[1][0] as { requestId: string })
      .requestId,
  ).not.toEqual(
    (vi.mocked(submitCustody).mock.calls[0][0] as { requestId: string })
      .requestId,
  );
});
