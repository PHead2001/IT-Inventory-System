import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
const qrMocks = vi.hoisted(() => ({
  render: vi.fn(async () => 'data:image/png;base64,iVBORw0KGgo='),
}));
vi.mock('qrcode', () => ({
  default: { toDataURL: qrMocks.render },
}));
import { LabelSheet, barcodePayload } from './label-sheet';

it.each(['size', 'text'] as const)(
  'retries normal text sizing after %s changes while retaining its QR',
  async (change) => {
    const overflow = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('text-[9pt]') &&
          this.textContent === 'Long adapter name' &&
          (this.closest('.label-card') as HTMLElement)?.style.height === '35mm'
          ? 20
          : 0;
      });
    try {
      const record = {
        kind: 'quantity' as const,
        key: 'fit-record',
        name: 'Long adapter name',
        path: '/inventory/quantity/fit-record',
      };
      const props = {
        records: [record],
        origin: 'https://inventory.example.test',
        preview: false,
        page: 'letter' as const,
        format: 'qr' as const,
      };
      const view = render(
        <LabelSheet {...props} size="70x35" generation="small" />,
      );
      await waitFor(() =>
        expect(screen.getByText(record.name)).toHaveClass('text-[8pt]'),
      );
      await waitFor(() =>
        expect(document.querySelector('.label-card')).toHaveAttribute(
          'data-code-ready',
          'true',
        ),
      );
      const card = document.querySelector('.label-card');
      const qr = screen.getByRole('img');
      const qrCalls = qrMocks.render.mock.calls.length;
      const name = change === 'text' ? 'Adapter' : record.name;
      view.rerender(
        <LabelSheet
          {...props}
          records={[{ ...record, name }]}
          size={change === 'size' ? '90x50' : '70x35'}
          generation="refitted"
        />,
      );
      expect(screen.getByText(name)).toHaveClass('text-[9pt]');
      expect(document.querySelector('.label-card')).toBe(card);
      expect(screen.getByRole('img')).toBe(qr);
      expect(qrMocks.render.mock.calls.length).toBe(qrCalls);
      await waitFor(() =>
        expect(card).toHaveAttribute('data-code-ready', 'true'),
      );
      view.rerender(
        <LabelSheet {...props} size="70x35" generation="small-again" />,
      );
      await waitFor(() =>
        expect(screen.getByText(record.name)).toHaveClass('text-[8pt]'),
      );
    } finally {
      overflow.mockRestore();
    }
  },
);

it('reflows a resized preview without remounting its QR image or changing printable identity', async () => {
  const record = {
    kind: 'quantity' as const,
    key: '7b84a7cf-197b-45b1-8016-87482d124cb4',
    name: '3FT adapter',
    humanId: '00124',
    path: '/inventory/quantity/7b84a7cf-197b-45b1-8016-87482d124cb4',
  };
  const props = {
    records: [record],
    origin: 'https://inventory.example.test',
    preview: false,
    page: 'letter' as const,
    format: 'qr' as const,
  };
  const view = render(
    <LabelSheet {...props} size="70x35" generation="small" />,
  );
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'true',
    ),
  );
  const card = document.querySelector('.label-card');
  const qr = screen.getByRole('img', { name: 'QR code for 3FT adapter' });
  view.rerender(<LabelSheet {...props} size="90x50" generation="large" />);
  expect(document.querySelector('.label-card')).toBe(card);
  expect(screen.getByRole('img', { name: 'QR code for 3FT adapter' })).toBe(qr);
  expect((card as HTMLElement).style.width).toBe('90mm');
  expect((card as HTMLElement).style.height).toBe('50mm');
  expect(card).toHaveTextContent('Item code: 00124');
  await waitFor(() => expect(card).toHaveAttribute('data-code-ready', 'true'));
});

it('retains later record images across earlier queue inserts, removals, reorders and copy changes', async () => {
  const rows = ['A', 'B', 'C'].map((name) => ({
    kind: 'quantity' as const,
    key: `key-${name}`,
    name,
    path: `/inventory/quantity/${name}`,
  }));
  const props = {
    origin: 'https://inventory.example.test',
    preview: false,
    size: '90x50' as const,
    page: 'letter' as const,
    format: 'qr' as const,
    generation: 'same',
  };
  const view = render(<LabelSheet {...props} records={rows} />);
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(3));
  const b = screen.getByRole('img', { name: 'QR code for B' });
  const c = screen.getByRole('img', { name: 'QR code for C' });
  const added = {
    ...rows[0],
    key: 'key-D',
    name: 'D',
    path: '/inventory/quantity/D',
  };
  view.rerender(<LabelSheet {...props} records={[added, ...rows]} />);
  expect(screen.getByRole('img', { name: 'QR code for B' })).toBe(b);
  expect(screen.getByRole('img', { name: 'QR code for C' })).toBe(c);
  view.rerender(
    <LabelSheet {...props} records={[rows[2], rows[0], rows[0], rows[1]]} />,
  );
  expect(screen.getByRole('img', { name: 'QR code for B' })).toBe(b);
  expect(screen.getByRole('img', { name: 'QR code for C' })).toBe(c);
  await waitFor(() =>
    expect(screen.getAllByRole('img', { name: 'QR code for A' })).toHaveLength(
      2,
    ),
  );
  view.rerender(<LabelSheet {...props} records={[rows[1], rows[2]]} />);
  expect(screen.getByRole('img', { name: 'QR code for B' })).toBe(b);
  expect(screen.getByRole('img', { name: 'QR code for C' })).toBe(c);
});

it('does not reuse a previous QR while the same card identity receives a new path', async () => {
  const id = crypto.randomUUID();
  const record = {
    kind: 'quantity' as const,
    key: id,
    name: 'Adapters',
    categoryName: 'Cables',
    path: '/inventory/quantity/' + id,
  };
  const view = render(
    <LabelSheet
      records={[record]}
      origin="https://inventory.example.test"
      preview={false}
      size="90x50"
      page="letter"
      format="qr"
      generation="first"
    />,
  );
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'true',
    ),
  );
  let resolveNext!: (image: string) => void;
  qrMocks.render.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      resolveNext = resolve;
    }),
  );
  view.rerender(
    <LabelSheet
      records={[{ ...record, path: record.path + '/changed' }]}
      origin="https://inventory.example.test"
      preview={false}
      size="90x50"
      page="letter"
      format="qr"
      generation="second"
    />,
  );
  expect(document.querySelector('.label-card')).toHaveAttribute(
    'data-code-ready',
    'false',
  );
  expect(
    screen.queryByRole('img', { name: 'QR code for Adapters' }),
  ).toBeNull();
  resolveNext('data:image/png;base64,iVBORw0KGgo=');
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'true',
    ),
  );
});

it('does not mark current-generation text measured before fonts settle', async () => {
  const previousFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  let finishFonts!: () => void;
  const fonts = {
    status: 'loading',
    ready: new Promise<void>((resolve) => {
      finishFonts = resolve;
    }),
  };
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: fonts,
  });
  try {
    render(
      <LabelSheet
        records={[
          {
            kind: 'quantity',
            key: crypto.randomUUID(),
            name: 'Adapters',
            categoryName: 'Cables',
            path: '/inventory/quantity/font-check',
          },
        ]}
        origin="https://inventory.example.test"
        preview={false}
        size="90x50"
        page="letter"
        format="qr"
        generation="font-check"
      />,
    );
    const card = document.querySelector('.label-card');
    expect(card).toHaveAttribute('data-text-measured', 'false');
    expect(card).toHaveAttribute('data-code-ready', 'false');
    fonts.status = 'loaded';
    finishFonts();
    await waitFor(() =>
      expect(card).toHaveAttribute('data-text-measured', 'true'),
    );
  } finally {
    if (previousFonts) Object.defineProperty(document, 'fonts', previousFonts);
    else Reflect.deleteProperty(document, 'fonts');
  }
});

it('keeps quantity identity as the canonical QR URL even when Code 128 is selected', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  const quantity = {
    kind: 'quantity' as const,
    key: id,
    name: 'Cables',
    categoryName: 'Cables',
    path: '/inventory/quantity/' + id,
  };
  expect(barcodePayload(quantity)).toBeNull();
  render(
    <LabelSheet
      records={[quantity, quantity]}
      origin="https://inventory.example.test"
      preview={false}
      size="90x50"
      page="letter"
      format="code128"
      generation="test"
    />,
  );
  await waitFor(() =>
    expect(
      document.querySelectorAll('.label-card[data-code-ready="true"]'),
    ).toHaveLength(2),
  );
  expect(
    screen.getAllByRole('img', { name: 'QR code for Cables' }),
  ).toHaveLength(2);
  expect(document.querySelectorAll('.label-card')).toHaveLength(2);
  expect(document.querySelector('.label-print-root')).not.toHaveAttribute(
    'data-print-authorized',
  );
  expect(document.querySelector('.label-print-root')).not.toHaveTextContent(
    'QR used:',
  );
  expect(document.querySelector('style')?.textContent).toContain(
    '.label-print-root:not([data-print-authorized="true"]) { display: none !important; }',
  );
});

it('prints stable identity and product facts without mutable holdings or lifecycle text', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  render(
    <LabelSheet
      records={[
        {
          kind: 'quantity',
          key: id,
          name: '3FT 10Gbps adapter 00124',
          humanId: '00124',
          categoryName: 'Adapters',
          manufacturer: 'Acme',
          model: '3FT 10Gbps',
          path: '/inventory/quantity/' + id,
        },
        {
          kind: 'asset',
          key: crypto.randomUUID(),
          name: 'Switch 10Gbps',
          barcode: 'sw-00124',
          serialNumber: 'SN-00124',
          categoryName: 'Networking',
          path: '/inventory/assets/stable-id',
        },
      ]}
      origin="https://inventory.example.test"
      preview
      size="90x50"
      page="letter"
      format="code128"
      generation="stable-content"
    />,
  );
  const sheet = document.querySelector('.label-print-root');
  expect(sheet).toHaveTextContent('3FT 10Gbps adapter 00124');
  expect(sheet).toHaveTextContent('Item code: 00124');
  expect(sheet).toHaveTextContent('Serial: SN-00124');
  expect(sheet).toHaveTextContent('Preview label');
  expect(sheet).not.toHaveTextContent(
    /stock|available|storage|site|archived|retired|QR used:/i,
  );
  await waitFor(() =>
    expect(
      document.querySelectorAll('.label-card[data-code-ready="true"]'),
    ).toHaveLength(2),
  );
});

it('uses the full name and curated product context without slicing by character count', () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  const name = 'Very long asset name '.repeat(12);
  render(
    <LabelSheet
      records={[
        {
          kind: 'asset',
          key: id,
          name,
          categoryName: 'Computers',
          manufacturer: 'Acme',
          model: '3FT 10Gbps',
          path: '/inventory/assets/' + id,
        },
      ]}
      origin="https://inventory.example.test"
      preview
      size="70x35"
      page="letter"
      format="qr"
      generation="test"
    />,
  );
  expect(screen.getByText(name.trim())).toBeInTheDocument();
  expect(screen.getByText('Computers · Acme · 3FT 10Gbps')).toBeInTheDocument();
  expect(screen.queryByText(id)).not.toBeInTheDocument();
  expect(
    document.querySelector('.label-card')?.getAttribute('style'),
  ).toContain('width: 70mm');
  expect(
    document.querySelector('.label-card')?.getAttribute('style'),
  ).toContain('height: 35mm');
});

it('scales Code 128 bars and quiet zones at physical module width', async () => {
  render(
    <LabelSheet
      records={[
        {
          kind: 'location',
          key: 'ITC',
          name: 'IT Closet',
          locationHierarchy: 'IT Closet',
          path: '/locations/ITC',
        },
      ]}
      origin="https://inventory.example.test"
      preview
      size="90x50"
      page="letter"
      format="code128"
      generation="test"
    />,
  );
  const svg = screen.getByRole('img', { name: 'Code 128 LOC:ITC' });
  await waitFor(() => expect(svg).not.toHaveClass('hidden'));
  const viewBox = svg.getAttribute('viewBox')!.split(' ').map(Number);
  expect(viewBox).toHaveLength(4);
  expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
  expect(Number.parseFloat(svg.getAttribute('width') ?? '')).toBe(viewBox[2]);
  expect(
    Number.parseFloat(
      svg.getAttribute('style')?.match(/width:\s*([0-9.]+)mm/)?.[1] ?? '',
    ),
  ).toBeCloseTo(viewBox[2] * 0.3);
  expect(viewBox[2]).toBeGreaterThan(20); // internal quiet zones flank actual bars
});

it('shows the quantity Item code as human identity while retaining stable QR navigation', async () => {
  const id = '7b84a7cf-197b-45b1-8016-87482d124cb4';
  render(
    <LabelSheet
      records={[
        {
          kind: 'quantity',
          key: id,
          name: 'Chargers',
          humanId: 'SKU-0042',
          categoryName: 'Adapters',
          path: '/inventory/quantity/' + id,
        },
      ]}
      origin="https://inventory.example.test"
      preview={false}
      size="70x35"
      page="A4"
      format="qr"
      generation="test"
    />,
  );
  expect(screen.getByText('Item code: SKU-0042')).toBeInTheDocument();
  expect(screen.getByText('Adapters')).toBeInTheDocument();
  expect(
    screen.queryByText('Right Storage / Shelf 3A'),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(id)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'true',
    ),
  );
});

it('reports measured text overflow and denies code readiness for a physically unfit label', async () => {
  const originalScroll = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight',
  );
  const originalClient = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-fit-text') ? 100 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-fit-text') ? 10 : 0;
    },
  });
  try {
    render(
      <LabelSheet
        records={[
          {
            kind: 'location',
            key: 'ITC',
            name: 'Overlong name',
            locationHierarchy: 'Closet / Shelf',
            path: '/locations/ITC',
          },
        ]}
        origin="https://inventory.example.test"
        preview={false}
        size="70x35"
        page="letter"
        format="qr"
        generation="test"
      />,
    );
    await waitFor(() =>
      expect(document.querySelector('.label-card')).toHaveAttribute(
        'data-text-overflow',
        'true',
      ),
    );
    expect(document.querySelector('.label-card')).toHaveAttribute(
      'data-code-ready',
      'false',
    );
    expect(
      screen.getByText('Text does not fit this label. Choose a larger size.'),
    ).toBeInTheDocument();
  } finally {
    if (originalScroll)
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalScroll,
      );
    if (originalClient)
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalClient,
      );
  }
});
