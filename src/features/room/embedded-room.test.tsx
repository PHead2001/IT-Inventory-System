import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { EmbeddedRoom } from './embedded-room';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '../scan/assign-batch';
import type { LocationRef } from '../inventory/contracts-ui';
const driver = vi.hoisted(() => ({
  authority: {
    actorId: 'actor',
    backend: 'https://backend.example',
    generation: 'verified',
    revision: 0,
    epoch: 0,
  },
}));
vi.mock('./scene/camera-snapshot-provider', () => ({
  useRoomSceneAuthority: () => driver.authority,
}));
vi.mock('next/dynamic', () => ({
  default:
    () =>
    (props: {
      onReady(): void;
      onGraphicsActiveChange(active: boolean): void;
      locationOccupancy?: unknown;
      showCounts?: boolean;
      canFocusSelected?: boolean;
      focusRequest?: { code: string | null };
      selectionMode?: string;
    }) => (
      <div
        data-testid="embedded-scene"
        data-counts={JSON.stringify(props.locationOccupancy ?? null)}
        data-overlay={String(props.showCounts)}
        data-focus-enabled={String(props.canFocusSelected)}
        data-focus-code={props.focusRequest?.code ?? ''}
        data-selection-mode={props.selectionMode}
      >
        <button
          type="button"
          onClick={() => {
            props.onGraphicsActiveChange(true);
            props.onReady();
          }}
        >
          Start renderer
        </button>
        <button
          type="button"
          onClick={() => props.onGraphicsActiveChange(false)}
        >
          Pause renderer
        </button>
      </div>
    ),
}));
afterEach(() => vi.unstubAllGlobals());
const locations: LocationRef[] = [
  {
    id: 'root',
    code: 'ITC',
    name: 'Closet',
    breadcrumb: 'Closet',
    parentId: null,
    active: true,
    can_hold_inventory: false,
  },
  {
    id: 'drawer',
    code: 'ITC-D01',
    name: 'Drawer 1',
    breadcrumb: 'Closet / Drawer 1',
    parentId: 'root',
    active: true,
    can_hold_inventory: true,
  },
];
it('keeps an authorized unmodeled child in a modeled space on the text path without a scene or count request', () => {
  const unmodeled = {
    ...locations[1],
    id: 'unmodeled',
    code: 'ITC-EXTRA',
    name: 'Extra storage',
  };
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(
    <EmbeddedRoom
      locations={[...locations, unmodeled]}
      code={unmodeled.code}
      permittedCodes={[unmodeled.code]}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByText(/This location has no modeled map/)).toBeVisible();
  expect(screen.queryByTestId('embedded-scene')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it('retains the modeled room root overview through its canonical room binding', () => {
  render(
    <EmbeddedRoom
      locations={locations}
      code="ITC"
      permittedCodes={[]}
      onSelect={vi.fn()}
    />,
  );
  const scene = screen.getByTestId('embedded-scene');
  expect(scene).toHaveAttribute('data-focus-enabled', 'true');
  expect(scene).toHaveAttribute('data-focus-code', 'ITC');
  expect(screen.queryByText(/This location has no modeled map/)).toBeNull();
});
it('propagates preview mode while preserving selected focus and count capability', () => {
  render(
    <EmbeddedRoom
      locations={locations}
      code="ITC-D01"
      permittedCodes={[]}
      selectionMode="preview"
      onSelect={vi.fn()}
    />,
  );
  const scene = screen.getByTestId('embedded-scene');
  expect(scene).toHaveAttribute('data-selection-mode', 'preview');
  expect(scene).toHaveAttribute('data-focus-enabled', 'true');
  expect(scene).toHaveAttribute('data-focus-code', 'ITC-D01');
});
it.each(['actor', 'backend', 'generation'])(
  'does not rebind embedded counts after a committed %s A/B/A cycle without a global event',
  async (field) => {
    const original = driver.authority;
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetcher);
    const ui = (ready = true, generation = 'verified') => (
      <PrivacyReadinessContext
        value={{
          ready,
          generation,
          revocationRevision: readPrivacyRevocationRevision(),
          verifiedEpoch: assignmentEpoch(),
        }}
      >
        <EmbeddedRoom
          locations={locations}
          code="ITC-D01"
          permittedCodes={[]}
          onSelect={vi.fn()}
        />
      </PrivacyReadinessContext>
    );
    const view = render(ui());
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Start renderer' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    view.rerender(ui(false));
    expect(screen.getByTestId('embedded-scene')).toHaveAttribute(
      'data-counts',
      'null',
    );
    view.rerender(ui());
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    driver.authority = {
      ...original,
      ...(field === 'actor'
        ? { actorId: 'other-actor' }
        : field === 'backend'
          ? { backend: 'https://other.example' }
          : { generation: 'other' }),
    };
    view.rerender(ui(true, field === 'generation' ? 'other' : 'verified'));
    driver.authority = original;
    view.rerender(ui());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('embedded-scene')).toHaveAttribute(
      'data-counts',
      'null',
    );
  },
);
it('requests bounded authorized selected counts only after graphics activation and keeps optional overlay off', async () => {
  const fetcher = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        identity: {
          userId: 'actor',
          backend: 'https://backend.example',
          environment: window.location.origin,
          spaceId: 'it-closet',
          filter: 'type=all;status=active',
          generation: new URL(url, window.location.origin).searchParams.get(
            'generation',
          ),
        },
        counts: {
          'ITC-D01': {
            quantity_product_count: '2',
            quantity_unit_count: '37',
            asset_count: '1',
          },
        },
      }),
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <PrivacyReadinessContext
      value={{
        ready: true,
        generation: 'verified',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <EmbeddedRoom
        locations={locations}
        code="ITC-D01"
        permittedCodes={[]}
        onSelect={vi.fn()}
      />
    </PrivacyReadinessContext>,
  );
  expect(fetcher).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Start renderer' }));
  await waitFor(() =>
    expect(screen.getByTestId('embedded-scene')).toHaveAttribute(
      'data-counts',
      '{"ITC-D01":{"quantity_product_count":"2","quantity_unit_count":"37","asset_count":"1"}}',
    ),
  );
  expect(fetcher).toHaveBeenCalledOnce();
  expect(screen.getByTestId('embedded-scene')).toHaveAttribute(
    'data-overlay',
    'false',
  );
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: 'Pause renderer' }));
  expect(screen.getByTestId('embedded-scene')).toHaveAttribute(
    'data-counts',
    'null',
  );
});
it('conceals counts and rejects a late response after the active scene is withdrawn', async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  render(
    <PrivacyReadinessContext
      value={{
        ready: true,
        generation: 'verified',
        revocationRevision: readPrivacyRevocationRevision(),
        verifiedEpoch: assignmentEpoch(),
      }}
    >
      <EmbeddedRoom
        locations={locations}
        code="ITC-D01"
        permittedCodes={[]}
        onSelect={vi.fn()}
      />
    </PrivacyReadinessContext>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Start renderer' }));
  expect(screen.getByText(/Loading counts/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Pause renderer' }));
  await act(async () => finish({ ok: false }));
  expect(screen.getByTestId('embedded-scene')).toHaveAttribute(
    'data-counts',
    'null',
  );
  expect(screen.queryByText(/counts are unavailable/)).toBeNull();
});
