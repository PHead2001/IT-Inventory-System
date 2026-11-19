import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/font/local', () => ({
  default: () => ({ variable: 'local-font' }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}));
vi.mock('@/lib/supabase/config', () => ({
  supabaseConfig: () => ({ url: 'https://theme-test.supabase.co' }),
}));
import RootLayout from './layout';

it('serves scoped Dark and reduced-motion defaults with parser bootstrap before the client body', async () => {
  const markup = renderToStaticMarkup(
    await RootLayout({ children: <p>Workspace</p> }),
  );
  expect(markup).toMatch(/<html[^>]*data-motion="reduced"/);
  expect(markup).toMatch(/<html[^>]*data-theme="dark"/);
  expect(markup).toContain('https%3A%2F%2Ftheme-test.supabase.co:anonymous');
  expect(markup.indexOf('src="/theme-bootstrap.v1.js"')).toBeLessThan(
    markup.indexOf('<body>'),
  );
});
