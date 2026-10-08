import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'local-font' }),
}));
import RootLayout from './layout';

it('serves reduced-motion CSS state before client preferences can hydrate', () => {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <p>Workspace</p>
    </RootLayout>,
  );
  expect(markup).toMatch(/<html[^>]*data-motion="reduced"/);
});
