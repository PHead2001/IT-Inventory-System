import { collectRoomObstructionRects } from '@/components/experience/room-obstructions';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render as rawRender,
  screen,
  within,
} from '@testing-library/react';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  invalidateAssignmentCallbacks,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';
function render(ui: React.ReactNode) {
  return rawRender(ui, {
    wrapper: ({ children }) => (
      <PrivacyReadinessContext
        value={{
          ready: true,
          visible: true,
          generation: 'peek-tests',
          verifiedEpoch: assignmentEpoch(),
          revocationRevision: readPrivacyRevocationRevision(),
        }}
      >
        {children}
      </PrivacyReadinessContext>
    ),
  });
}
import type { PeekPayload } from './contracts';
const mocks = vi.hoisted(() => ({
  path: '/history',
  query: '',
  download: vi.fn(),
  auth: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.path,
  useSearchParams: () => new URLSearchParams(mocks.query),
}));
vi.mock('@/components/experience/route-link', () => ({
  default: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@/components/experience/motion-preference', () => ({
  useEffectiveReducedMotion: () => true,
}));
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { onAuthStateChange: mocks.auth },
    storage: { from: () => ({ download: mocks.download }) },
  }),
}));
import {
  HistoryList,
  InventoryRows,
  LocationLink,
} from '@/features/inventory/components/read-ui';
import type {
  HistoryEvent,
  InventoryResult,
} from '@/features/inventory/contracts-ui';
import { PeekAnchor, PeekLink } from './peek-link';
import { PeekProvider } from './peek-provider';
import { invalidatePeeks } from './invalidation';
const actor = '00000000-0000-4000-8000-000000000001';
const target = { kind: 'asset' as const, id: actor };
const backend = 'https://backend.test';
const record: PeekPayload = {
  target,
  name: 'Laptop',
  status: 'active',
  assetTag: 'TAG-001',
  stock: null,
  locations: [
    {
      code: 'ITC-D1',
      name: 'Drawer 1',
      breadcrumb: 'IT Closet / Drawer 1',
      active: true,
      canHold: true,
      spaceRootCode: null,
    },
  ],
  moreLocations: false,
  siteName: null,
  photo: null,
};
const envelope = (payload = record) =>
  Response.json({ actor, backend, payload });
function fixture({
  actorId = actor,
  environment = backend,
}: { actorId?: string; environment?: string } = {}) {
  return (
    <PeekProvider actor={actorId} backend={environment}>
      <PeekLink peekTarget={target} href={'/inventory/assets/' + actor}>
        View laptop
      </PeekLink>
      <button>Next action</button>
    </PeekProvider>
  );
}
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function mount() {
  const view = render(fixture());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    function (this: HTMLElement) {
      return (this.closest('[hidden], [inert]') ||
      getComputedStyle(this).visibility === 'hidden'
        ? []
        : [new DOMRect(10, 20, 120, 30)]) as unknown as DOMRectList;
    },
  );
  mocks.path = '/history';
  mocks.query = '';
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({
    data: { subscription: { unsubscribe: mocks.unsubscribe } },
  });
  mocks.download.mockResolvedValue({ data: new Blob(['photo']), error: null });
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(envelope()));
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:private-photo'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('keeps ordinary links usable without mounting an authenticated peek scope', () => {
  render(
    <PeekLink peekTarget={target} href="/inventory/assets/record">
      Native link
    </PeekLink>,
  );
  expect(screen.getByRole('link')).toHaveAttribute(
    'href',
    '/inventory/assets/record',
  );
  expect(fetch).not.toHaveBeenCalled();
});
it('places typed render-trigger ARIA and events on the native anchor inside a preserved boundary', async () => {
  render(
    <PeekProvider actor={actor} backend={backend}>
      <PeekAnchor target={target}>
        {(trigger) => (
          <a {...trigger} href={'/inventory/assets/' + actor}>
            Wrapped record
          </a>
        )}
      </PeekAnchor>
    </PeekProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const link = screen.getByRole('link', { name: 'Wrapped record' });
  expect(link).toHaveAttribute('aria-haspopup', 'dialog');
  act(() => link.focus());
  await settle();
  expect(link).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(link, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('composes original anchor handlers and retains its ref without preventing modified navigation', async () => {
  const onFocus = vi.fn();
  const onClick = vi.fn();
  const measurement = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  const reference = { current: null as HTMLAnchorElement | null };
  render(
    <PeekProvider actor={actor} backend={backend}>
      <PeekLink
        peekTarget={target}
        href={'/inventory/assets/' + actor}
        ref={reference}
        onFocus={onFocus}
        onClick={onClick}
      >
        Original anchor
      </PeekLink>
    </PeekProvider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const link = screen.getByRole('link', { name: 'Original anchor' });
  // Rendering/decoration forwards callbacks; it does not execute them or read
  // the anchor measurement through the captured DOM ref before an event.
  expect(onFocus).not.toHaveBeenCalled();
  expect(onClick).not.toHaveBeenCalled();
  expect(measurement).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(reference.current).toBe(link);
  act(() => link.focus());
  await settle();
  expect(onFocus).toHaveBeenCalledOnce();
  const click = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  act(() => link.dispatchEvent(click));
  expect(onClick).toHaveBeenCalledOnce();
  expect(click.defaultPrevented).toBe(false);
  expect(reference.current).toBe(link);
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens after 400ms fine hover and transfers pointer to interactive card without closing', async () => {
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  fireEvent.pointerEnter(link, { pointerType: 'mouse' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(399);
  });
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await settle();
  const card = screen.getByRole('dialog');
  expect(within(card).getByText('Laptop')).toBeInTheDocument();
  fireEvent.pointerLeave(link, { pointerType: 'mouse' });
  fireEvent.pointerEnter(card, { pointerType: 'mouse' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(180);
  });
  expect(card).toBeInTheDocument();
  expect(card.querySelector('a button')).toBeNull();
});
it('opens from keyboard focus without moving focus; Tab reaches card controls and Escape restores anchor', async () => {
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  expect(link).toHaveFocus();
  expect(link).toHaveAttribute('aria-expanded', 'true');
  fireEvent.keyDown(link, { key: 'Tab' });
  const card = screen.getByRole('dialog');
  expect(within(card).getByRole('link', { name: 'Open record' })).toHaveFocus();
  expect(
    within(card).getByText('No room model for this location'),
  ).toBeInTheDocument();
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(link).toHaveFocus();
});
it('lets keyboard leave the final card control to the next document control without a trap', async () => {
  await mount();
  act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
  await settle();
  const close = screen.getByRole('button', { name: 'Close preview' });
  act(() => close.focus());
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(screen.getByRole('button', { name: 'Next action' })).toHaveFocus();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('skips touch focus but supports subsequent keyboard focus on a hybrid device', async () => {
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  fireEvent.pointerDown(link, { pointerType: 'touch' });
  act(() => link.focus());
  await settle();
  expect(fetch).not.toHaveBeenCalled();
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  fireEvent.keyDown(document, { key: 'Tab' });
  act(() => link.focus());
  await settle();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('preserves native modified clicking while pending and does not wait for data', async () => {
  let finish!: (result: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    ctrlKey: true,
  });
  act(() => link.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(link).toHaveAttribute('href', '/inventory/assets/' + actor);
  expect(screen.queryByRole('dialog')).toBeNull();
  finish(envelope());
  await settle();
});
it('revalidates cached data on every open and suppresses peeks on the record own page', async () => {
  const view = await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  fireEvent.keyDown(link, { key: 'Escape' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  let finish!: (result: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  act(() => link.focus());
  expect(
    within(screen.getByRole('dialog')).getByText('Laptop'),
  ).toBeInTheDocument();
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  mocks.path = '/inventory/assets/' + actor;
  view.rerender(fixture());
  expect(screen.queryByRole('dialog')).toBeNull();
  finish(envelope());
  await settle();
});
it.each(['mutation', 'auth', 'actor', 'backend', 'navigation'])(
  'clears private payload/photo and rejects late reads after %s',
  async (reason) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      envelope({
        ...record,
        photo: { path: 't/first.jpg', name: 'Laptop recognition' },
      }),
    );
    const view = await mount();
    act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
    await settle();
    expect(
      screen.getByRole('img', { name: 'Laptop recognition' }),
    ).toHaveAttribute('src', 'blob:private-photo');
    if (reason === 'mutation') act(() => invalidatePeeks());
    if (reason === 'auth')
      act(() => mocks.auth.mock.calls[0][0]('SIGNED_OUT', null));
    if (reason === 'actor')
      view.rerender(
        fixture({ actorId: '00000000-0000-4000-8000-000000000002' }),
      );
    if (reason === 'backend')
      view.rerender(fixture({ environment: 'https://other.test' }));
    if (reason === 'navigation') {
      mocks.path = '/labels';
      view.rerender(fixture());
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo');
  },
);
it('never creates a blob URL from Storage bytes delivered after close', async () => {
  let finish!: (result: { data: Blob; error: null }) => void;
  mocks.download.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(fetch).mockResolvedValueOnce(
    envelope({ ...record, photo: { path: 't/photo.jpg', name: 'Photo' } }),
  );
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  fireEvent.keyDown(link, { key: 'Escape' });
  finish({ data: new Blob(['late']), error: null });
  await settle();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it('does not render private record data delivered after sign-out', async () => {
  let finish!: (result: Response) => void;
  vi.mocked(fetch).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
  await settle();
  act(() => mocks.auth.mock.calls[0][0]('SIGNED_OUT', null));
  finish(envelope());
  await settle();
  expect(screen.queryByText('Laptop')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('revokes the previous photo before rendering its replacement path', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    envelope({
      ...record,
      photo: { path: 't/first.jpg', name: 'First photo' },
    }),
  );
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'First photo');
  fireEvent.keyDown(link, { key: 'Escape' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  vi.mocked(fetch).mockResolvedValueOnce(
    envelope({
      ...record,
      photo: { path: 't/second.jpg', name: 'Second photo' },
    }),
  );
  act(() => link.focus());
  await settle();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo');
  expect(screen.getByRole('img')).toHaveAttribute('alt', 'Second photo');
});
it('shares physical slots with an uncooperative Storage blob and never dispatches a third operation early', async () => {
  let photoFinish!: (result: { data: Blob; error: null }) => void;
  let apiFinish!: (result: Response) => void;
  mocks.download.mockReturnValue(
    new Promise((resolve) => {
      photoFinish = resolve;
    }),
  );
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      envelope({
        ...record,
        photo: { path: 't/held.jpg', name: 'Held photo' },
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve) => {
        apiFinish = resolve;
      }),
    )
    .mockResolvedValueOnce(envelope());
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  expect(mocks.download).toHaveBeenCalledOnce();
  act(() => invalidatePeeks());
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  act(() => link.focus());
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  act(() => invalidatePeeks());
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  act(() => link.focus());
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  photoFinish({ data: new Blob(['old body']), error: null });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  apiFinish(envelope());
  await settle();
});
it('ignores a retired JWT callback and clears the active card on its own JWT denial', async () => {
  const photo = { path: 't/jwt-photo.jpg', name: 'Authorized photo' };
  vi.mocked(fetch).mockResolvedValueOnce(envelope({ ...record, photo }));
  let urlNumber = 0;
  vi.mocked(URL.createObjectURL).mockImplementation(
    () => 'blob:private-' + ++urlNumber,
  );
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  fireEvent.keyDown(link, { key: 'Escape' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  let deny!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      deny = resolve;
    }),
  );
  act(() => link.focus());
  await settle();
  expect(
    within(screen.getByRole('dialog')).getByText('Laptop'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('img', { name: 'Authorized photo' }),
  ).toBeInTheDocument();
  fireEvent.keyDown(link, { key: 'Escape' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  vi.mocked(fetch).mockResolvedValueOnce(
    envelope({
      ...record,
      name: 'Newer laptop',
      photo: { ...photo, path: 't/newer-photo.jpg' },
    }),
  );
  act(() => link.focus());
  await settle();
  expect(
    within(screen.getByRole('dialog')).getByText('Newer laptop'),
  ).toBeInTheDocument();
  const latestBlob = screen.getByRole('img').getAttribute('src');
  deny(Response.json({ error: 'forbidden' }, { status: 403 }));
  await settle();
  expect(
    within(screen.getByRole('dialog')).getByText('Newer laptop'),
  ).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('src', latestBlob);
  fireEvent.keyDown(link, { key: 'Escape' });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(latestBlob);
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: 'forbidden' }, { status: 403 }),
  );
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  act(() => link.focus());
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('img')).toBeNull();
});
it('retains two held Storage slots across repeated provider replacements and ignores old callbacks and denials', async () => {
  const finishes: Array<
    (result: {
      data: Blob | null;
      error: null | { statusCode: string };
    }) => void
  > = [];
  mocks.download.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishes.push(resolve);
      }),
  );
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      envelope({
        ...record,
        photo: { path: 't/old-one.jpg', name: 'First held photo' },
      }),
    )
    .mockResolvedValueOnce(
      envelope({
        ...record,
        photo: { path: 't/old-two.jpg', name: 'Second held photo' },
      }),
    );
  const view = await mount();
  let link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  act(() => invalidatePeeks());
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  act(() => link.focus());
  await settle();
  expect(mocks.download).toHaveBeenCalledTimes(2);
  const nextActor = '00000000-0000-4000-8000-000000000002';
  view.rerender(fixture({ actorId: nextActor }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  link = screen.getByRole('link', { name: 'View laptop' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  act(() => link.focus());
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  const nextBackend = 'https://other.test';
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ actor: nextActor, backend: nextBackend, payload: record }),
  );
  view.rerender(fixture({ actorId: nextActor, environment: nextBackend }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  link = screen.getByRole('link', { name: 'View laptop' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  act(() => link.focus());
  await settle();
  expect(fetch).toHaveBeenCalledTimes(2);
  act(() => mocks.auth.mock.calls[0][0]('SIGNED_OUT', null));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  finishes[0]({ data: new Blob(['discarded old bytes']), error: null });
  await settle();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(
    within(screen.getByRole('dialog')).getByText('Laptop'),
  ).toBeInTheDocument();
  finishes[1]({ data: null, error: { statusCode: '403' } });
  await settle();
  expect(
    within(screen.getByRole('dialog')).getByText('Laptop'),
  ).toBeInTheDocument();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

const verified = () => ({
  ready: true,
  visible: true,
  generation: 'verified-peek',
  verifiedEpoch: assignmentEpoch(),
  revocationRevision: readPrivacyRevocationRevision(),
});
it.each([
  'unmanaged',
  'pending',
  'hidden',
  'epoch',
  'revision',
  'closed-trigger',
  'hidden-trigger',
])('does not open or read under %s presentation', async (mode) => {
  const grant = verified();
  if (mode === 'unmanaged') grant.generation = 'unmanaged';
  if (mode === 'pending') grant.ready = false;
  if (mode === 'hidden') grant.visible = false;
  if (mode === 'epoch') grant.verifiedEpoch--;
  if (mode === 'revision') grant.revocationRevision--;
  rawRender(
    <PrivacyReadinessContext value={grant}>
      <PeekProvider actor={actor} backend={backend}>
        {mode === 'closed-trigger' ? (
          <details>
            <summary>Details</summary>
            <PeekLink peekTarget={target} href={peekHrefForTest}>
              Blocked record
            </PeekLink>
          </details>
        ) : (
          <div hidden={mode === 'hidden-trigger'}>
            <PeekLink peekTarget={target} href={peekHrefForTest}>
              Blocked record
            </PeekLink>
          </div>
        )}
      </PeekProvider>
    </PrivacyReadinessContext>,
  );
  const link = screen.getByText('Blocked record');
  fireEvent.focus(link);
  fireEvent.pointerEnter(link, { pointerType: 'mouse' });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
const peekHrefForTest = '/inventory/assets/' + actor;
it.each(['assignment', 'revocation'])(
  'synchronously withdraws photo/card and rejects stale %s callbacks',
  async (mode) => {
    vi.mocked(fetch).mockResolvedValueOnce(
      envelope({
        ...record,
        photo: { path: 't/current.jpg', name: 'Current photo' },
      }),
    );
    await mount();
    act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
    await settle();
    expect(screen.getByRole('img')).toBeInTheDocument();
    act(() => {
      if (mode === 'assignment') invalidateAssignmentCallbacks();
      else revokePrivatePresentation();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo');
    fireEvent.focus(screen.getByRole('link', { name: 'View laptop' }));
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it('preserves the mounted task draft across actor/backend ownership changes and ignores the retired response', async () => {
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const app = (who = actor, env = backend) => (
    <PrivacyReadinessContext value={verified()}>
      <PeekProvider actor={who} backend={env}>
        <input aria-label="Retained draft" defaultValue="draft" />
        <PeekLink peekTarget={target} href={peekHrefForTest}>
          Record
        </PeekLink>
      </PeekProvider>
    </PrivacyReadinessContext>
  );
  const view = rawRender(app());
  const draft = screen.getByLabelText('Retained draft');
  fireEvent.change(draft, { target: { value: 'unsaved' } });
  act(() => screen.getByRole('link', { name: 'Record' }).focus());
  await settle();
  const authCallback = mocks.auth.mock.calls[0][0];
  const nextActor = '00000000-0000-4000-8000-000000000002';
  view.rerender(app(nextActor, 'https://second.test'));
  expect(screen.getByLabelText('Retained draft')).toBe(draft);
  expect(draft).toHaveValue('unsaved');
  finish(envelope());
  await settle();
  expect(screen.queryByText('Laptop')).toBeNull();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      actor: nextActor,
      backend: 'https://second.test',
      payload: { ...record, name: 'Current actor record' },
    }),
  );
  act(() => draft.focus());
  act(() => screen.getByRole('link', { name: 'Record' }).focus());
  await settle();
  expect(screen.getByText('Current actor record')).toBeInTheDocument();
  act(() => authCallback('SIGNED_OUT', null));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('restores focus on Escape without auto-reopening and accepts a new explicit keyboard intent', async () => {
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  const close = screen.getByRole('button', { name: 'Close preview' });
  act(() => close.focus());
  fireEvent.keyDown(close, { key: 'Escape' });
  await settle();
  expect(link).toHaveFocus();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(link, { key: 'ArrowDown' });
  await settle();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('removes expired cached data while a card remains open and a later revalidation stalls', async () => {
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  fireEvent.keyDown(link, { key: 'Escape' });
  act(() => screen.getByRole('button', { name: 'Next action' }).focus());
  let finish!: (value: Response) => void;
  try {
    vi.mocked(fetch).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    act(() => link.focus());
    await settle();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30001);
    });
    expect(screen.queryByText('Laptop')).toBeNull();
    // Settlement releases the shared physical lease without restoring expired data.
    finish(envelope());
    await settle();
    expect(screen.queryByText('Laptop')).toBeNull();
  } finally {
    finish?.(envelope());
    await settle();
  }
});
it('rejects hidden responsive triggers during an in-flight read', async () => {
  let finish!: (r: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await mount();
  const link = screen.getByRole('link', { name: 'View laptop' });
  act(() => link.focus());
  await settle();
  act(() => {
    link.style.visibility = 'hidden';
  });
  await settle();
  finish(envelope());
  await settle();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Laptop')).toBeNull();
});

it.each(['history-main', 'history-detail', 'location-row', 'location-link'])(
  'opens lazy current details from the actual %s consumer without altering its href',
  async (surface) => {
    const location = {
      id: actor,
      code: 'ITC-D1',
      name: 'Drawer 1',
      breadcrumb: 'IT Closet / Drawer 1',
      active: true,
      can_hold_inventory: true,
      parentId: null,
    };
    const event: HistoryEvent = {
      id: actor,
      kind: 'asset',
      entityId: actor,
      entityName: 'History device',
      eventType: 'created',
      at: '2026-10-19T12:00:00Z',
      actorName: 'Staff',
      reason: null,
      assignment: null,
      lines: [],
      fromLocation: null,
      toLocation: null,
      metadataChanges: [],
      customMetadataPresent: false,
      customMetadataChanged: false,
    };
    const row: InventoryResult = {
      kind: 'asset',
      id: actor,
      name: 'Location device',
      categoryName: 'Computers',
      status: 'active',
      location,
      quantity: null,
      assetTag: 'TAG-001',
      serialNumber: null,
      recordedTotal: null,
      availableQuantity: null,
      assignedQuantity: null,
      ownedQuantity: null,
      reorderThreshold: null,
      stockState: 'disabled',
    };
    const content =
      surface === 'history-main' ? (
        <HistoryList events={[event]} returnTo="/history?page=2" />
      ) : surface === 'history-detail' ? (
        <HistoryList events={[event]} />
      ) : surface === 'location-row' ? (
        <InventoryRows rows={[row]} returnTo="/locations/ITC-D1" />
      ) : (
        <LocationLink location={location} />
      );
    const expected =
      surface === 'location-link'
        ? { kind: 'location' as const, code: 'ITC-D1' }
        : target;
    vi.mocked(fetch).mockResolvedValue(
      Response.json({
        actor,
        backend,
        payload: {
          ...record,
          target: expected,
          name: 'Current scoped summary',
        },
      }),
    );
    render(
      <PeekProvider actor={actor} backend={backend}>
        {content}
      </PeekProvider>,
    );
    const link = screen.getByRole('link', {
      name: surface.startsWith('history')
        ? 'History device'
        : surface === 'location-row'
          ? 'Location device'
          : /IT Closet/,
    });
    const href = link.getAttribute('href');
    expect(fetch).not.toHaveBeenCalled();
    act(() => link.focus());
    await settle();
    expect(
      within(screen.getByRole('dialog')).getByText('Current scoped summary'),
    ).toBeInTheDocument();
    expect(link).toHaveAttribute('href', href);
    const url = new URL(
      vi.mocked(fetch).mock.calls[0][0] as string,
      'https://inventory.test',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual(expected);
    expect(screen.getByRole('dialog').textContent).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f-]{27}|2026-10-19T/,
    );
  },
);

it('does not let a closed or hidden sibling trigger cancel the visible link owner', async () => {
  render(
    <PeekProvider actor={actor} backend={backend}>
      <details>
        <summary>Other details</summary>
        <PeekLink peekTarget={target} href={peekHrefForTest}>
          Closed sibling
        </PeekLink>
      </details>
      <div hidden>
        <PeekLink peekTarget={target} href={peekHrefForTest}>
          Hidden sibling
        </PeekLink>
      </div>
      <PeekLink peekTarget={target} href={peekHrefForTest}>
        Visible owner
      </PeekLink>
    </PeekProvider>,
  );
  act(() => screen.getByRole('link', { name: 'Visible owner' }).focus());
  await settle();
  expect(screen.getByRole('dialog')).toHaveTextContent('Laptop');
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(['401', '403'])(
  'withdraws the current Storage %s peek without globally revoking authentication',
  async (statusCode) => {
    const revision = readPrivacyRevocationRevision();
    mocks.download.mockResolvedValue({ data: null, error: { statusCode } });
    vi.mocked(fetch).mockResolvedValueOnce(
      envelope({
        ...record,
        photo: { path: 't/denied.jpg', name: 'Denied photo' },
      }),
    );
    await mount();
    const link = screen.getByRole('link', { name: 'View laptop' });
    act(() => link.focus());
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(readPrivacyRevocationRevision()).toBe(revision);
    act(() => screen.getByRole('button', { name: 'Next action' }).focus());
    act(() => link.focus());
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);

it('registers only a painted current peek as a room obstruction and retires on withdrawal and unmount', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 120, 30),
  );
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const viewport = new DOMRect(0, 0, 1200, 900);
  try {
    const view = render(
      <PeekProvider actor={actor} backend={backend}>
        <div hidden>
          <PeekLink peekTarget={target} href={peekHrefForTest}>
            Hidden preview link
          </PeekLink>
        </div>
        <PeekLink peekTarget={target} href={peekHrefForTest}>
          View laptop
        </PeekLink>
        <button>Next action</button>
      </PeekProvider>,
    );
    fireEvent.focus(screen.getByText('Hidden preview link'));
    await settle();
    expect(collectRoomObstructionRects(canvas, viewport)).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    const link = screen.getByRole('link', { name: 'View laptop' });
    act(() => link.focus());
    await settle();
    expect(collectRoomObstructionRects(canvas, viewport)).toHaveLength(1);
    act(() => invalidatePeeks());
    expect(collectRoomObstructionRects(canvas, viewport)).toHaveLength(0);
    act(() => screen.getByRole('button', { name: 'Next action' }).focus());
    act(() => link.focus());
    await settle();
    expect(collectRoomObstructionRects(canvas, viewport)).toHaveLength(1);
    view.unmount();
    expect(collectRoomObstructionRects(canvas, viewport)).toHaveLength(0);
  } finally {
    canvas.remove();
  }
});

it.each(['backend', 'verification'])(
  'retires Auth callbacks across same-actor %s replacement and preserves current denial',
  async (change) => {
    const app = (environment = backend, generation = 'first') => (
      <PrivacyReadinessContext value={{ ...verified(), generation }}>
        <PeekProvider actor={actor} backend={environment}>
          <input aria-label="Owned draft" defaultValue="unsaved" />
          <PeekLink peekTarget={target} href={peekHrefForTest}>
            Owned link
          </PeekLink>
        </PeekProvider>
      </PrivacyReadinessContext>
    );
    const view = rawRender(app());
    const draft = screen.getByLabelText('Owned draft');
    act(() => screen.getByRole('link', { name: 'Owned link' }).focus());
    await settle();
    const oldAuth = mocks.auth.mock.calls.at(-1)![0];
    const nextBackend =
      change === 'backend' ? 'https://same-actor-new-backend.test' : backend;
    view.rerender(
      app(nextBackend, change === 'verification' ? 'second' : 'first'),
    );
    expect(screen.getByLabelText('Owned draft')).toBe(draft);
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        actor,
        backend: nextBackend,
        payload: {
          ...record,
          name: 'Successor record',
          photo: { path: 't/successor.jpg', name: 'Successor photo' },
        },
      }),
    );
    act(() => draft.focus());
    act(() => screen.getByRole('link', { name: 'Owned link' }).focus());
    await settle();
    expect(screen.getByRole('dialog')).toHaveTextContent('Successor record');
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Successor photo');
    vi.mocked(URL.revokeObjectURL).mockClear();
    act(() => oldAuth('SIGNED_OUT', null));
    act(() => oldAuth('TOKEN_REFRESHED', null));
    expect(screen.getByRole('dialog')).toHaveTextContent('Successor record');
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const currentAuth = mocks.auth.mock.calls.at(-1)![0];
    expect(currentAuth).not.toBe(oldAuth);
    act(() => currentAuth('SIGNED_OUT', null));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo');
  },
);

it('replaces admission on navigation, query and Back while preserving the mounted draft', async () => {
  vi.mocked(fetch).mockImplementation(async () => envelope());
  const app = () => (
    <PeekProvider actor={actor} backend={backend}>
      <input aria-label="Retained route draft" defaultValue="original" />
      <PeekLink peekTarget={target} href={peekHrefForTest}>
        Route device
      </PeekLink>
    </PeekProvider>
  );
  const view = render(app());
  const draft = screen.getByRole('textbox');
  fireEvent.change(draft, { target: { value: 'unsaved' } });
  for (const [path, query] of [
    ['/history', ''],
    ['/inventory', ''],
    ['/inventory', 'page=2'],
    ['/history', ''],
  ]) {
    mocks.path = path;
    mocks.query = query;
    view.rerender(app());
    act(() => screen.getByRole('link', { name: 'Route device' }).focus());
    await settle();
    expect(screen.getByRole('dialog')).toHaveTextContent('Laptop');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('textbox')).toBe(draft);
    expect(draft).toHaveValue('unsaved');
  }
  expect(fetch).toHaveBeenCalledTimes(4);
});
it('replaces target admission for A to B to A and rejects the retired A result', async () => {
  const other = {
    kind: 'asset' as const,
    id: '00000000-0000-4000-8000-000000000002',
  };
  let finish!: (value: Response) => void;
  try {
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const app = (value = target) => (
      <PeekProvider actor={actor} backend={backend}>
        <PeekLink peekTarget={value} href={'/inventory/assets/' + value.id}>
          Reused target
        </PeekLink>
      </PeekProvider>
    );
    const view = render(app());
    act(() => screen.getByRole('link').focus());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    vi.mocked(fetch).mockResolvedValueOnce(
      envelope({ ...record, target: other, name: 'Other record' }),
    );
    view.rerender(app(other));
    act(() => screen.getByRole('link').focus());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('dialog')).toHaveTextContent('Other record');
    vi.mocked(fetch).mockResolvedValueOnce(
      envelope({ ...record, name: 'Current A' }),
    );
    view.rerender(app());
    act(() => screen.getByRole('link').focus());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    finish(envelope({ ...record, name: 'Retired A' }));
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByRole('dialog')).toHaveTextContent('Current A');
    expect(screen.queryByText('Retired A')).toBeNull();
  } finally {
    finish?.(envelope());
    await settle();
  }
});
it('forwards the physical lease signal and no-store option to authenticated Storage and revokes on close', async () => {
  vi.mocked(fetch).mockResolvedValue(
    envelope({
      ...record,
      photo: { path: 'private/photo.jpg', name: 'Laptop photo' },
    }),
  );
  await mount();
  act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
  await settle();
  expect(mocks.download).toHaveBeenCalledWith(
    'private/photo.jpg',
    {},
    { signal: expect.any(AbortSignal), cache: 'no-store' },
  );
  const signal = mocks.download.mock.calls[0][2].signal as AbortSignal;
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:private-photo');
  fireEvent.keyDown(document, { key: 'Escape' });
  await settle();
  expect(signal.aborted).toBe(false); // settled operations no longer need cancellation
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-photo');
});

it.each(['401', '403'])(
  'ignores a deadline-retired Storage %s and admits the next valid photo',
  async (statusCode) => {
    let finish!: (value: {
      data: Blob | null;
      error: { statusCode: string } | null;
    }) => void;
    mocks.download.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    vi.mocked(fetch).mockImplementation(async () =>
      envelope({
        ...record,
        photo: { path: 't/deadline.jpg', name: 'Deadline photo' },
      }),
    );
    await mount();
    act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
    await settle();
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    finish({ data: null, error: { statusCode } });
    await settle();
    expect(screen.getByRole('dialog')).toHaveTextContent('Laptop');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => screen.getByRole('button', { name: 'Next action' }).focus());
    act(() => screen.getByRole('link', { name: 'View laptop' }).focus());
    await settle();
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Deadline photo');
  },
);

it('hands final Tab to the native summary, skipping hidden, inert, disabled and closed disclosure descendants in DOM order', async () => {
  render(
    <PeekProvider actor={actor} backend={backend}>
      <PeekLink peekTarget={target} href={peekHrefForTest}>
        Tab source
      </PeekLink>
      <div hidden>
        <a href="/hidden">Hidden link</a>
      </div>
      <div inert>
        <button>Inert action</button>
      </div>
      <fieldset disabled>
        <input aria-label="Disabled fieldset input" />
      </fieldset>
      <input type="hidden" aria-label="Hidden input" />
      <div style={{ display: 'none' }}>
        <button>CSS hidden action</button>
      </div>
      <a href="/negative" tabIndex={-1}>
        Programmatic link
      </a>
      <details>
        <summary>Native next disclosure</summary>
        <a href="/closed-holding">Closed holding link</a>
      </details>
      <button>After disclosure</button>
    </PeekProvider>,
  );
  act(() => screen.getByRole('link', { name: 'Tab source' }).focus());
  await settle();
  const close = screen.getByRole('button', { name: 'Close preview' });
  act(() => close.focus());
  fireEvent.keyDown(close, { key: 'Tab' });
  expect(screen.getByText('Native next disclosure')).toHaveFocus();
  expect(
    screen.getByText('Native next disclosure').closest('details'),
  ).not.toHaveAttribute('open');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each([
  ['ITO', 'ITO', 'Open in Spaces'],
  ['ITO-GENERAL', 'ITO', 'Open in Spaces'],
  ['STAGING', 'ITO', 'Open in Spaces'],
  ['ITC-UNMODELED', 'ITC', 'Open in Spaces'],
  ['ITC-S1A', 'ITC', 'Show in room'],
  ['ITO-SPOOF', null, null],
] as const)(
  'joins peek %s to the canonical room/Spaces action',
  async (code, spaceRootCode, label) => {
    const locationTarget = { kind: 'location' as const, code };
    vi.mocked(fetch).mockResolvedValue(
      envelope({
        ...record,
        target: locationTarget,
        name: 'Current location',
        locations: [
          {
            code,
            spaceRootCode,
            name: 'Storage',
            breadcrumb: 'Office / Storage',
            active: true,
            canHold: true,
          },
        ],
      }),
    );
    render(
      <PeekProvider actor={actor} backend={backend}>
        <PeekLink peekTarget={locationTarget} href={'/locations/' + code}>
          Location peek
        </PeekLink>
      </PeekProvider>,
    );
    act(() => screen.getByRole('link', { name: 'Location peek' }).focus());
    await settle();
    const card = screen.getByRole('dialog');
    if (label) {
      const action = within(card).getByRole('link', {
        name:
          'Show ' +
          code +
          (label === 'Show in room' ? ' in room' : ' in Spaces'),
      });
      expect(action).toHaveTextContent(label);
      expect(action).toHaveAttribute('href', '/room?location=' + code);
    } else {
      expect(
        within(card).getByText('No room model for this location'),
      ).toBeVisible();
      expect(
        within(card).queryByRole('link', { name: /in Spaces/ }),
      ).toBeNull();
    }
  },
);
