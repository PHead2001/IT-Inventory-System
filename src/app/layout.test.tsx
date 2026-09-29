import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import RootLayout from './layout';

it('serves reduced-motion CSS state before client preferences can hydrate', () => {
  const markup = renderToStaticMarkup(
    <RootLayout>
      <p>Workspace</p>
    </RootLayout>,
  );
  expect(markup).toContain('<html lang="en" data-motion="reduced">');
});
