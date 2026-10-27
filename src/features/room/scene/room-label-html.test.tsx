import { readFileSync } from 'node:fs';
import type { CSSProperties } from 'react';
import styles from '../room-visual.module.css';
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

const canvas = vi.hoisted(() => ({ width: 315 }));
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: { size: { width: number } }) => unknown) =>
    selector({ size: { width: canvas.width } }),
}));

vi.mock('@react-three/drei', () => ({
  // Match the installed Drei Html's createRoot boundary, not a context-preserving portal.
  Html: function SeparateDomRoot({
    children,
    style,
  }: {
    children: ReactNode;
    style?: CSSProperties;
  }) {
    useLayoutEffect(() => {
      const host = document.createElement('div');
      host.dataset.htmlRoot = 'true';
      for (const [name, value] of Object.entries(style ?? {})) {
        if (name.startsWith('--')) host.style.setProperty(name, String(value));
        else Object.assign(host.style, { [name]: value });
      }
      document.body.append(host);
      const root = createRoot(host);
      root.render(children);
      return () => {
        queueMicrotask(() => {
          root.unmount();
          host.remove();
        });
      };
    }, [children, style]);
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

it('uses actual canvas CSS width for selected full text across the separate Html root, resizing and deselection', async () => {
  // Inject the production label rules with their actual CSS-module names. JSDOM
  // proves cascade and inherited width contracts here, never line layout/height.
  const css = readFileSync(
    'src/features/room/room-visual.module.css',
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');
  const sheet = document.createElement('style');
  const names = [
    'labelFull',
    'labelCompact',
    'locationLabel',
    'decorativeLabel',
    'selectedLabel',
    'countBadge',
  ];
  sheet.textContent = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) =>
      selector
        .split(',')
        .every((part) =>
          names.some((name) => part.trim().startsWith('.' + name)),
        ),
    )
    .map(
      ([, selector, body]) =>
        selector.replace(/\.([A-Za-z][\w-]*)/g, (whole, name) =>
          styles[name] ? '.' + styles[name] : whole,
        ) +
        '{' +
        body +
        '}',
    )
    .join('\n');
  expect(sheet.textContent).toContain('.' + styles.selectedLabel + ' {');
  document.head.append(sheet);
  // JSDOM leaves inherited white-space empty. Follow the real DOM ancestor
  // values only in that case; a browser's resolved value wins immediately.
  const inheritedWhiteSpace = (element: HTMLElement) => {
    for (
      let current: HTMLElement | null = element;
      current;
      current = current.parentElement
    ) {
      const value = getComputedStyle(current).whiteSpace;
      if (value && value !== 'inherit' && value !== 'unset') return value;
    }
    return '';
  };

  const registry = createRoomLabelRegistry(vi.fn());
  const label =
    'Shared equipment shelf for replacement laptop adapters and carefully packed networking accessories';
  const counts = '1 product / 9,007,199,254,740,993 units / 0 assets';
  const fixture = (selected: boolean, interactive = true) => (
    <LabelLayoutProvider registry={registry}>
      <RoomLabelHtml selected={selected} style={{ whiteSpace: 'nowrap' }}>
        <RoomLabel
          id="responsive-selected"
          label={label}
          code="ITC-S1A"
          priority={1}
          selected={selected}
          occupancy={{
            quantity_product_count: '1',
            quantity_unit_count: '9007199254740993',
            asset_count: '0',
          }}
          onSelect={interactive ? vi.fn() : undefined}
        />
      </RoomLabelHtml>
    </LabelLayoutProvider>
  );
  const normalizeWidth = (value: string) => {
    const node = document.createElement('span');
    node.style.maxWidth = value;
    return node.style.maxWidth;
  };
  const view = render(fixture(true));
  try {
    for (const [width, outer, full] of [
      [315, 285, 267],
      [640, 298, 280],
      [80, 50, 32],
      [44, 44, 26],
      [0, 44, 26],
    ]) {
      canvas.width = width;
      view.rerender(fixture(true));
      await act(async () => {});
      const button = document.querySelector<HTMLButtonElement>(
        '[data-room-label-code]',
      )!;
      expect(button).toHaveAttribute(
        'aria-label',
        'Select ' + label + ' (ITC-S1A); ' + counts + ' at this location',
      );
      const host = button.closest<HTMLElement>('[data-html-root]')!;
      expect(host.style.maxWidth).toBe(outer + 'px');
      expect(host.style.getPropertyValue('--room-selected-label-width')).toBe(
        outer + 'px',
      );
      expect(
        host.style.getPropertyValue('--room-selected-label-text-width'),
      ).toBe(full + 'px');
      expect(getComputedStyle(button).maxWidth).toBe(
        'var(--room-selected-label-width)',
      );
      expect(
        getComputedStyle(button.querySelector('[data-room-label-full]')!)
          .maxWidth,
      ).toBe('var(--room-selected-label-text-width)');
      expect(getComputedStyle(button).minWidth).toBe('44px');
      expect(getComputedStyle(button).fontSize).toBe('13px');
      expect(getComputedStyle(button).lineHeight).toBe('18px');
      expect(button).toHaveTextContent(label);
      expect(button).toHaveTextContent(counts);
    }
    canvas.width = 315;
    view.rerender(fixture(false));
    await act(async () => {});
    const ordinary = document.querySelector<HTMLButtonElement>(
      '[data-room-label-code]',
    )!;
    expect(
      ordinary.closest<HTMLElement>('[data-html-root]')!.style.maxWidth,
    ).toBe(normalizeWidth('min(240px, calc(100vw - 80px))'));
    expect(getComputedStyle(ordinary).maxWidth).toBe('240px');
    expect(
      getComputedStyle(ordinary.querySelector('[data-room-label-full]')!)
        .maxWidth,
    ).toBe('220px');
    // Focus/hover expansion retains the existing nonselected cap and marker contract.
    act(() => ordinary.focus());
    expect(getComputedStyle(ordinary).maxWidth).toBe('240px');
    view.rerender(fixture(true, false));
    await act(async () => {});
    expect(document.querySelector('button')).toBeNull();
    const preview = document.querySelector<HTMLElement>(
      '[data-room-decorative-label]',
    )!;
    expect(getComputedStyle(preview).maxWidth).toBe(
      'var(--room-selected-label-width)',
    );
    expect(preview).toHaveTextContent(label);
    expect(preview).toHaveTextContent(counts);
    expect(preview).not.toHaveAttribute('tabindex');
    // CameraFacingLabel supplies nowrap above the separate Html root. The
    // selected noninteractive path must explicitly restore text wrapping too.
    expect(
      preview.closest<HTMLElement>('[data-html-root]')!.style.whiteSpace,
    ).toBe('nowrap');
    expect(inheritedWhiteSpace(preview)).toBe('normal');
    expect(getComputedStyle(preview).overflowWrap).toBe('anywhere');
    view.rerender(fixture(false, false));
    await act(async () => {});
    const ordinaryPreview = document.querySelector<HTMLElement>(
      '[data-room-decorative-label]',
    )!;
    expect(inheritedWhiteSpace(ordinaryPreview)).toBe('nowrap');
    expect(ordinaryPreview).not.toHaveAttribute('tabindex');
    expect(ordinaryPreview).toHaveTextContent(label);
  } finally {
    view.unmount();
    await act(async () => {});
    sheet.remove();
    canvas.width = 315;
  }
});
