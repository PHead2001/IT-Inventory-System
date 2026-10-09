import { act, render, screen } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { useLayoutEffect, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';
import { RoomLabel } from './room-label';
import { RoomLabelHtml } from './room-label-html';

vi.mock('@react-three/drei', () => ({
  // Match the installed Drei Html's createRoot boundary, not a context-preserving portal.
  Html: function SeparateDomRoot({ children }: { children: ReactNode }) {
    useLayoutEffect(() => {
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      root.render(children);
      return () => {
        queueMicrotask(() => {
          root.unmount();
          host.remove();
        });
      };
    }, [children]);
    return null;
  },
}));

it('bridges decorative and interactive Html roots into their own room registry', async () => {
  const first = createRoomLabelRegistry(vi.fn());
  const second = createRoomLabelRegistry(vi.fn());
  const firstRegister = vi.spyOn(first, 'register');
  const secondRegister = vi.spyOn(second, 'register');
  const select = vi.fn();
  const view = render(
    <>
      <LabelLayoutProvider registry={first}>
        <RoomLabelHtml>
          <RoomLabel
            id="drawer"
            code="ITC-D01"
            label="Drawer 1"
            priority={3}
            occupancy={{
              quantity_product_count: '1',
              quantity_unit_count: '31',
              asset_count: '2',
            }}
            onSelect={select}
          />
        </RoomLabelHtml>
        <RoomLabelHtml>
          <RoomLabel id="door" label="Door" priority={0} />
        </RoomLabelHtml>
      </LabelLayoutProvider>
      <LabelLayoutProvider registry={second}>
        <RoomLabelHtml>
          <RoomLabel
            id="drawer"
            code="ITC-D01"
            label="Other room drawer"
            priority={1}
            onSelect={vi.fn()}
          />
        </RoomLabelHtml>
      </LabelLayoutProvider>
    </>,
  );
  await act(async () => {});
  expect(firstRegister).toHaveBeenCalledTimes(2);
  expect(firstRegister.mock.calls.map(([id]) => id).sort()).toEqual([
    'door',
    'drawer',
  ]);
  expect(secondRegister).toHaveBeenCalledOnce();
  expect(firstRegister.mock.calls[0][1]).not.toBe(
    secondRegister.mock.calls[0][1],
  );
  const button = screen.getByRole('button', {
    name: /Select Drawer 1.*1 product.*31 units.*2 assets/,
  });
  expect(button).toHaveTextContent('1 product / 31 units / 2 assets');
  act(() => button.click());
  expect(select).toHaveBeenCalledExactlyOnceWith('ITC-D01');
  view.unmount();
  await act(async () => {});
  expect(screen.queryByText('Door')).not.toBeInTheDocument();
});
