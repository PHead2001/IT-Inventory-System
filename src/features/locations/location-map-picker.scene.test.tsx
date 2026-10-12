import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
const scene = vi.hoisted(() => ({ children: null as ReactNode }));
vi.mock('../room/scene/safe-canvas', () => ({
  SafeCanvas: ({ children }: { children: ReactNode }) => {
    scene.children = children;
    return <canvas />;
  },
}));
vi.mock('next/dynamic', () => ({
  default: () => (props: ComponentProps<typeof RoomScene>) => (
    <RoomScene {...props} />
  ),
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
