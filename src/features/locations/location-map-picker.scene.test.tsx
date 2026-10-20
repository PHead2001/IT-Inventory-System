import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from 'react';
import LocationMapPicker from './location-map-picker';
import RoomScene from '../room/scene/room-scene';
import { RoomCameraSnapshotProvider } from '../room/scene/camera-snapshot-provider';
import { PrivacyReadinessContext } from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
} from '../scan/assign-batch';
import type { LocationRef } from '../inventory/contracts-ui';
const scene = vi.hoisted(() => ({
  children: null as ReactNode,
  props: null as ComponentProps<typeof RoomScene> | null,
}));
vi.mock('../room/scene/safe-canvas', () => ({
  SafeCanvas: ({ children }: { children: ReactNode }) => {
    scene.children = children;
    return <canvas />;
  },
}));
vi.mock('next/dynamic', () => ({
  default: () => (props: ComponentProps<typeof RoomScene>) => {
    scene.props = props;
    return <RoomScene {...props} />;
  },
}));
const root: LocationRef = {
  id: 'root',
  code: 'ITC',
  name: 'Closet',
  breadcrumb: 'Closet',
  parentId: null,
  active: true,
  can_hold_inventory: false,
};
const drawer: LocationRef = {
  id: 'drawer',
  code: 'ITC-D01',
  name: 'Drawer 1',
  breadcrumb: 'Closet / Drawer 1',
  parentId: 'root',
  active: true,
  can_hold_inventory: true,
};
const other = {
  ...drawer,
  id: 'other',
  code: 'ITC-D02',
  name: 'Drawer 2',
  breadcrumb: 'Closet / Drawer 2',
};
beforeEach(() => {
  scene.props = null;
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
it.each([false, true])(
  'keeps an unmodeled logical candidate without a fabricated map; explicit modeled replacement: %s',
  async (replace) => {
    const user = userEvent.setup(),
      use = vi.fn();
    const unmodeled = {
      ...drawer,
      id: 'software',
      code: 'SOFTWARE',
      name: 'Software',
      breadcrumb: 'Software',
      parentId: null,
    };
    render(
      <LocationMapPicker
        locations={[root, drawer, unmodeled]}
        initialValue={unmodeled.id}
        disabled={false}
        onUse={use}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        'This location has no modeled map. Use its recorded location below.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Location map' })).toBeNull();
    expect(scene.props).toBeNull();
    expect(
      screen.getByText(unmodeled.breadcrumb, { selector: 'p[role="status"]' }),
    ).toBeVisible();
    expect(use).not.toHaveBeenCalled();
    if (replace) {
      await user.click(
        screen.getByRole('combobox', { name: 'Choose location in browser' }),
      );
      await user.click(screen.getByRole('treeitem', { name: /Drawer 1/ }));
      expect(scene.props?.selectedCode).toBe(drawer.code);
      expect(scene.props?.focusRequest.code).toBe(drawer.code);
    }
    expect(use).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Use location' }));
    expect(use).toHaveBeenCalledExactlyOnceWith(
      replace ? drawer.code : unmodeled.code,
    );
  },
);
it('replaces a failed map with the unmodeled alternative while keeping keyboard selection and confirmation', async () => {
  const user = userEvent.setup(),
    use = vi.fn();
  const unmodeled = {
    ...drawer,
    id: 'unmodeled',
    code: 'UNMODELED',
    name: 'Unmodeled destination',
    breadcrumb: 'Unmodeled destination',
    parentId: null,
  };
  render(
    <LocationMapPicker
      locations={[root, drawer, unmodeled]}
      initialValue={drawer.id}
      disabled={false}
      onUse={use}
      onClose={vi.fn()}
    />,
  );
  act(() => scene.props!.onFailure('Actual scene failed'));
  expect(screen.getByText(/Map unavailable/)).toBeVisible();
  const browser = screen.getByRole('combobox', {
    name: 'Choose location in browser',
  });
  browser.focus();
  await user.keyboard('{Enter}');
  const search = screen.getByRole('combobox', { name: 'Search locations' });
  expect(search).toHaveFocus();
  await user.type(search, unmodeled.code);
  await user.keyboard('{ArrowDown}{Enter}');
  expect(browser).toHaveTextContent(unmodeled.code);
  expect(
    screen.getByText(
      'This location has no modeled map. Use its recorded location below.',
    ),
  ).toBeVisible();
  expect(screen.queryByText(/Map unavailable/)).toBeNull();
  expect(document.querySelector('canvas')).toBeNull();
  expect(use).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Use location' }));
  expect(use).toHaveBeenCalledExactlyOnceWith(unmodeled.code);
});
it.each(['actor', 'backend', 'generation'])(
  'blocks a captured production RoomScene selection through the original picker after committed %s A/B/A',
  (field) => {
    const use = vi.fn();
    const ui = (identity = 'a', ready = true) => (
      <PrivacyReadinessContext
        value={{
          ready,
          generation:
            field === 'generation' && identity === 'b' ? 'other' : 'verified',
          revocationRevision: readPrivacyRevocationRevision(),
          verifiedEpoch: assignmentEpoch(),
        }}
      >
        <RoomCameraSnapshotProvider
          actorId={
            field === 'actor' && identity === 'b' ? 'actor-b' : 'actor-a'
          }
          backend={
            field === 'backend' && identity === 'b'
              ? 'https://other.example'
              : 'https://backend.example'
          }
        >
          <LocationMapPicker
            locations={[root, drawer, other]}
            initialValue=""
            disabled={false}
            onUse={use}
            onClose={vi.fn()}
          />
        </RoomCameraSnapshotProvider>
      </PrivacyReadinessContext>
    );
    const view = render(ui());
    let captured: ((code: string) => void) | undefined;
    const find = (children: ReactNode) =>
      Children.forEach(children, (child) => {
        if (!isValidElement<Record<string, unknown>>(child)) return;
        if (child.props.node)
          captured = child.props.onSelect as typeof captured;
        find(child.props.children as ReactNode);
      });
    find(scene.children);
    expect(captured).toBeTypeOf('function');
    act(() => captured!(drawer.code));
    expect(
      screen.getByText(drawer.breadcrumb, { selector: 'p[role="status"]' }),
    ).toBeInTheDocument();
    view.rerender(ui('a', false));
    act(() => captured!(other.code));
    expect(
      screen.getByText(drawer.breadcrumb, { selector: 'p[role="status"]' }),
    ).toBeInTheDocument();
    view.rerender(ui());
    act(() => captured!(other.code));
    expect(
      screen.getByText(other.breadcrumb, { selector: 'p[role="status"]' }),
    ).toBeInTheDocument();
    view.rerender(ui('b'));
    view.rerender(ui());
    act(() => captured!(drawer.code));
    expect(
      screen.getByText(other.breadcrumb, { selector: 'p[role="status"]' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog', { hidden: true })).toHaveAttribute(
      'hidden',
    );
    expect(use).not.toHaveBeenCalled();
  },
);
