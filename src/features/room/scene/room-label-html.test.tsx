import { readFileSync } from 'node:fs';
import type { CSSProperties } from 'react';
import styles from '../room-visual.module.css';
import { act, render, screen } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import {
  LabelLayoutProvider,
  createRoomLabelRegistry,
} from './label-layout-runtime';
import { RoomLabel } from './room-label';
import { RoomLabelHtml } from './room-label-html';
import {
  PrivacyReadinessContext,
  usePrivacyReadiness,
} from '@/components/auth/privacy-readiness';
import {
  assignmentEpoch,
  readPrivacyRevocationRevision,
  revokePrivatePresentation,
} from '@/features/scan/assign-batch';

const finalCounts = (root: ParentNode) =>
  [...root.querySelectorAll('[data-count-final]')]
    .map((element) => element.textContent)
    .join(' / ');

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
    const [host] = useState(() => document.createElement('div'));
    const root = useRef<ReturnType<typeof createRoot> | null>(null);
    useLayoutEffect(() => {
      host.dataset.htmlRoot = 'true';
      document.body.append(host);
      const owned = createRoot(host);
      root.current = owned;
      return () => {
        root.current = null;
        queueMicrotask(() => {
          owned.unmount();
          host.remove();
        });
      };
    }, [host]);
    // Installed Html keeps its independent root across children/style updates.
    useLayoutEffect(() => {
      host.style.cssText = '';
      for (const [name, value] of Object.entries(style ?? {})) {
        if (name.startsWith('--')) host.style.setProperty(name, String(value));
        else Object.assign(host.style, { [name]: value });
      }
      root.current?.render(children);
    }, [children, style, host]);
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
  expect(finalCounts(button)).toBe('1 product / 31 units / 2 assets');
  act(() => button.click());
  expect(select).toHaveBeenCalledExactlyOnceWith('ITC-D01');
  view.unmount();
  await act(async () => {});
  expect(screen.queryByText('Door')).not.toBeInTheDocument();
});

function PrivacyProbe({
  read,
}: {
  read: (value: ReturnType<typeof usePrivacyReadiness>) => void;
}) {
  const privacy = usePrivacyReadiness();
  useLayoutEffect(() => read(privacy), [privacy, read]);
  return null;
}

it('carries the exact existing privacy value into a persistent Html root and withdraws tickers before a root rerender', async () => {
  const frames = new Map<number, FrameRequestCallback>();
  let serial = 0;
  const motion = document.documentElement.dataset.motion;
  document.documentElement.dataset.motion = 'full';
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 240, 44),
  ] as unknown as DOMRectList);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const current = () => ({
    ready: true,
    visible: true,
    generation: 'room-member-a',
    verifiedEpoch: assignmentEpoch(),
    revocationRevision: readPrivacyRevocationRevision(),
  });
  const grant = current(),
    registry = createRoomLabelRegistry(vi.fn()),
    read = vi.fn();
  const tree = (
    privacy: ReturnType<typeof usePrivacyReadiness>,
    units: string,
  ) => (
    <PrivacyReadinessContext value={privacy}>
      <LabelLayoutProvider registry={registry}>
        <RoomLabelHtml selected>
          <PrivacyProbe read={read} />
          <RoomLabel
            id="privacy-counts"
            code="ITC-D07"
            label="Drawer 7"
            priority={3}
            selected
            occupancy={{
              quantity_product_count: '1',
              quantity_unit_count: units,
              asset_count: '0',
            }}
            onSelect={() => {}}
          />
        </RoomLabelHtml>
      </LabelLayoutProvider>
    </PrivacyReadinessContext>
  );
  const view = render(tree(grant, '20'));
  try {
    await act(async () => {});
    expect(read.mock.lastCall?.[0]).toBe(grant);
    expect(frames.size).toBe(0);
    const host = document.querySelector('[data-html-root]');
    view.rerender(tree(grant, '60'));
    await act(async () => {});
    expect(document.querySelector('[data-html-root]')).toBe(host);
    expect(frames.size).toBe(1);
    const units = () =>
      document.querySelectorAll('[data-count-visual]')[1]?.textContent;
    const paint = async (time: number) => {
      const callbacks = [...frames.values()];
      frames.clear();
      await act(async () => callbacks.forEach((callback) => callback(time)));
    };
    await paint(250);
    expect(units()).not.toBe('60 units');
    const stale = [...frames.values()];
    // No outer or independent-root render occurs before this global withdrawal.
    act(() => {
      revokePrivatePresentation();
      expect(frames.size).toBe(0);
    });
    expect(units()).toBe('60 units');
    await act(async () => stale.forEach((callback) => callback(400)));
    expect(units()).toBe('60 units');
    view.rerender(tree(grant, '70')); // stale captured grant cannot readmit
    await act(async () => {});
    expect(frames.size).toBe(0);
    const withheld = { ...current(), ready: false, visible: false };
    view.rerender(tree(withheld, '80'));
    await act(async () => {});
    expect(read.mock.lastCall?.[0]).toBe(withheld);
    expect(frames.size).toBe(0);
    const replacement = { ...current(), generation: 'room-member-b' };
    view.rerender(tree(replacement, '90'));
    await act(async () => {});
    expect(read.mock.lastCall?.[0]).toBe(replacement);
    expect(units()).toBe('90 units');
    expect(frames.size).toBe(0);
    view.rerender(tree(replacement, '100'));
    await act(async () => {});
    expect(frames.size).toBe(1);
    view.unmount();
    await act(async () => {});
    expect(frames.size).toBe(0);

    const unmanaged = { ...current(), generation: 'unmanaged' };
    const unmanagedView = render(tree(unmanaged, '110'));
    unmanagedView.rerender(tree(unmanaged, '120'));
    await act(async () => {});
    expect(read.mock.lastCall?.[0]).toBe(unmanaged);
    expect(units()).toBe('120 units');
    expect(frames.size).toBe(0);
    unmanagedView.unmount();
    await act(async () => {});
  } finally {
    view.unmount();
    await act(async () => {});
    if (motion === undefined) delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = motion;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
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
      expect(finalCounts(button)).toBe(counts);
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
    expect(finalCounts(preview)).toBe(counts);
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
